import {
  searchFailureSummary,
  type SearchFailure,
} from "../../search-feedback.ts";
import {
  readToolEvidence,
  discoveryReply,
  noSelectionReply,
  compactVideo,
} from "./evidence.ts";
import type { InformationSource } from "../../information.ts";
import { selectionReply } from "../../dj-selection.ts";
import { Composition } from "./composition.ts";
import { LEGACY_USER } from "../../accounts.ts";
import { djConfig, type DjConfig } from "../../dj-config.ts";
import type { Database } from "../../db.ts";
import { connectMusicMcp, musicTracks } from "../../music-mcp.ts";
import { selection, type DjInput, type Selection } from "./contracts.ts";
import { DjUnavailable } from "./errors.ts";
import { reserveDj } from "./quota.ts";
import { catalogSelection } from "./catalog.ts";
import { planTurn, initialMessages } from "./context.ts";
import { completeTurn, MAX_ROUNDS, type ChatTool } from "./provider.ts";
import type { TraceObserver } from "./journal/contracts.ts";

/** Bounded orchestration: gather evidence, validate selection, then return an operation. */
export async function djTurn(
  db: Database,
  input: DjInput,
  signal?: AbortSignal,
  config: DjConfig = djConfig(),
  userId = LEGACY_USER,
  observe?: TraceObserver,
) {
  const plan = planTurn(input);
  const { intent, targetCount, avoidRepeats, externalSearch } = plan;
  const catalogStarted = Date.now();
  const requested = await catalogSelection(db, input, userId, plan);
  observe?.({
    kind: "catalog",
    name: "catalog_lookup",
    status: "ok",
    durationMs: Date.now() - catalogStarted,
    output: requested ?? { matched: false },
  });
  if (requested) return requested;
  let expandedSelection = false;
  const composition = new Composition(input, plan);
  if (!config.configured)
    throw new DjUnavailable(
      "Le mode DJ attend la configuration de son IA côté serveur. Ta bibliothèque reste disponible.",
    );
  await reserveDj(db, userId);
  // A confirmation can refer to a card that is already playing/excluded from a
  // continuation. Hydrate its owned metadata without treating it as a new pick.
  const recentIds = [
    ...new Set([
      ...input.discoveryContext.map(({ id }) => id),
      ...(plan.playback?.current ? [plan.playback.current.id] : []),
    ]),
  ].filter((id) => !input.rejectedIds.includes(id));
  const recentTracks = recentIds.length
    ? await musicTracks(db, recentIds, userId)
    : [];
  const messages = initialMessages(
    input,
    plan,
    recentTracks.slice(-8).map(compactVideo),
  );
  const mcp = await connectMusicMcp(
    db,
    input.excludeIds,
    userId,
    externalSearch,
    plan.scope,
    input.rejectedIds,
  );
  const timeout = AbortSignal.any([
    AbortSignal.timeout(90000),
    ...(signal ? [signal] : []),
  ]);
  let toolCalls = 0;
  let searched = false;
  let informationRequested = false;
  const information = new Map<number, InformationSource>();
  let informationFailed = false;
  let failedSearches = 0;
  let reformulated = false;
  let youtubeDailyQuota = false;
  let clarifiedPartialIntent = false;
  const failures = new Map<SearchFailure["source"], SearchFailure>();
  const withSourceNote = (reply: string) => {
    const note = searchFailureSummary([...failures.values()], Date.now());
    return note
      ? `${reply} ${note} Je m’appuie sur les résultats disponibles.`
      : reply;
  };
  let visualUnsupported = false;
  function emptyReply() {
    return visualUnsupported && !failedSearches
      ? "YouTube ne permet pas de chercher par couleur ou détail de pochette. Choisis Mes playlists ou Partout pour explorer les miniatures de ta bibliothèque. Ta lecture reste inchangée."
      : noSelectionReply(
          searchFailureSummary([...failures.values()], Date.now()),
          plan.relative ? plan.playback?.current?.title : undefined,
        );
  }
  async function partialSelection() {
    const chosen = composition.recover();
    const tracks = externalSearch
      ? composition.tracks(chosen.ids)
      : await musicTracks(db, chosen.ids, userId);
    timeout.throwIfAborted();
    return {
      action: tracks.length ? chosen.action : ("keep" as const),
      tracks,
      ...(chosen.cards.length ? { discoveries: chosen.cards } : {}),
      reply: tracks.length
        ? withSourceNote(
            selectionReply(
              chosen.action as "replace" | "append",
              tracks,
              targetCount,
              chosen.explanation,
            ),
          )
        : chosen.cards.length
          ? withSourceNote(discoveryReply(chosen.cards, chosen.explanation))
          : emptyReply(),
      source: "mcp" as const,
    };
  }
  try {
    const listed = await mcp.client.listTools();
    const tools: ChatTool[] = listed.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    async function searchTool(
      name: string,
      args: Record<string, unknown>,
      id: string,
    ) {
      const isSearch = [
        "library_search",
        "youtube_search",
        "music_search",
      ].includes(name);
      let text: string;
      const started = Date.now();
      let status: "ok" | "partial" | "error" = "ok";
      try {
        const result = await mcp.client.callTool(
          { name, arguments: args },
          undefined,
          { signal: timeout },
        );
        const evidence = readToolEvidence(name, result);
        if (evidence.failedSources)
          status = evidence.items.length ? "partial" : "error";
        text = evidence.text;
        if (name === "seekInformation") {
          informationRequested = true;
          const data = JSON.parse(text);
          informationFailed = data.status !== "ok";
          const sources = (data.sources as InformationSource[]).map(
            (source) => ({ ...source, id: information.size + source.id }),
          );
          for (const source of sources) information.set(source.id, source);
          text = JSON.stringify({
            status: data.status,
            sources,
          });
        }
        composition.add(evidence.items);
        if (evidence.isSearch) searched = true;
        failedSearches += evidence.failedSources;
        if (evidence.isSearch) failures.delete("search");
        for (const source of evidence.recoveredSources) failures.delete(source);
        for (const failure of evidence.failures)
          failures.set(failure.source, failure);
        youtubeDailyQuota ||= evidence.youtubeDailyQuota;
        visualUnsupported ||= evidence.visualUnsupported;
      } catch (error) {
        status = "error";
        if (timeout.aborted)
          observe?.({
            kind: "tool",
            name,
            callId: id,
            status,
            durationMs: Date.now() - started,
            input: args,
            output: { error: "canceled" },
          });
        timeout.throwIfAborted();
        if (name === "seekInformation") {
          informationRequested = true;
          informationFailed = true;
        }
        if (isSearch) {
          searched = true;
          failedSearches++;
          const source =
            name === "library_search"
              ? "library"
              : name === "youtube_search"
                ? "youtube"
                : "search";
          failures.set(source, { source, reason: "unavailable" });
        }
        // Do not pass transport diagnostics or tool instructions to the model.
        text = JSON.stringify({
          error: "source_unavailable",
          source: name,
          tracks: [],
        });
      }
      let output: unknown = text;
      try {
        output = JSON.parse(text);
      } catch {
        /* Preserve non-JSON tool text. */
      }
      observe?.({
        kind: "tool",
        name,
        callId: id,
        status,
        durationMs: Date.now() - started,
        input: args,
        output,
      });
      messages.push({ role: "tool", tool_call_id: id, content: text });
    }
    for (let turn = 0; turn < MAX_ROUNDS; turn++) {
      if (turn === MAX_ROUNDS - 1)
        observe?.({
          kind: "policy",
          name: "compose_final",
          status: "ok",
          input: {
            candidates: composition.size,
            hasSelection: composition.hasSelection,
            scope: plan.scope,
          },
        });
      const message = await completeTurn(
        config,
        turn === MAX_ROUNDS - 1
          ? composition.finalMessages(
              [...information.values()],
              [...failures.values()],
            )
          : messages,
        tools,
        turn,
        timeout,
        observe,
      );
      const calls = message.tool_calls;
      if (Array.isArray(calls) && calls.length) {
        if (turn === MAX_ROUNDS - 1) break;
        if (calls.length > 4 || toolCalls + calls.length > 8)
          throw new DjUnavailable(
            "Le DJ n’a pas trouvé sa sélection cette fois. Précise l’ambiance.",
            502,
          );
        messages.push({
          role: "assistant",
          content: message.content ?? null,
          tool_calls: calls,
          ...(message.extra_content
            ? { extra_content: message.extra_content }
            : {}),
        });
        for (const call of calls) {
          toolCalls++;
          if (!listed.tools.some((t) => t.name === call.function?.name))
            throw new DjUnavailable(
              "Le DJ a demandé un outil indisponible.",
              502,
            );
          let args: unknown;
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            throw new DjUnavailable(
              "La recherche musicale du DJ est invalide.",
              502,
            );
          }
          await searchTool(
            call.function.name,
            args as Record<string, unknown>,
            call.id,
          );
        }
        // Sources are routed by the server. A single reformulation can explore
        // other musical clues freely; never force the playing artist as a filter.
        if (searched && !composition.size && !reformulated && toolCalls < 8) {
          reformulated = true;
          messages.push({
            role: "user",
            content:
              "La recherche n’a pas fourni de nouveau candidat. Repars du mot musical employé par l’utilisateur, seul, sans ajouter playlist ou plusieurs genres dans la même requête. Essaie ensuite une graphie ou un genre pertinent séparément. Une source en erreur ne rend pas les autres sources indisponibles. Si YouTube indique daily_quota, explore la bibliothèque autorisée avec des requêtes courtes ; ne demande pas à l’utilisateur de répéter son envie. Respecte les exclusions de la demande et les cartes rejetées. Si les sources restent sans résultat, conserve la lecture.",
          });
        }
        continue;
      }
      let output: Selection;
      try {
        output = selection.parse(JSON.parse(message.content ?? ""));
      } catch {
        throw new DjUnavailable(
          "Le DJ n’a pas renvoyé une sélection lisible. Réessaie.",
          502,
        );
      }
      // Let the model acknowledge a correction or discuss known context without
      // executing a tool or manufacturing another musical selection.
      if (
        !informationRequested &&
        output.kind === "conversation" &&
        output.action === "keep" &&
        !output.trackIds.length &&
        !output.discoveryIds?.length
      ) {
        return {
          action: "keep" as const,
          tracks: [],
          reply: output.reply,
          source: "mcp" as const,
        };
      }
      // A musical conclusion still needs evidence. This reminder does not force
      // ordinary conversation through search and remains bounded to one retry.
      if (!searched && !informationRequested && turn === 0) {
        messages.push({ role: "assistant", content: message.content ?? "" });
        messages.push({
          role: "user",
          content:
            "Cherche les indices de ma demande avec music_search avant de conclure ou de demander un titre exact. Propose les candidats vérifiés si plusieurs conviennent.",
        });
        continue;
      }
      if (!searched && !informationRequested)
        throw new DjUnavailable(
          "Je n’ai pas pu rechercher ces indices. Réessaie ; ta musique continue.",
          502,
        );
      if (
        informationRequested &&
        output.action === "keep" &&
        !output.trackIds.length &&
        !output.discoveryIds?.length
      ) {
        const cited = [...new Set(output.citationIds ?? [])]
          .filter((id) => information.has(id))
          .map((id) => information.get(id)!);
        return {
          action: "keep" as const,
          tracks: [],
          reply:
            information.size && cited.length
              ? output.reply
              : informationFailed
                ? "La recherche d’informations sur le Web est momentanément indisponible. Ta lecture continue ; réessaie dans un instant."
                : "Je n’ai pas trouvé de source exploitable pour confirmer cette information. Ta lecture continue.",
          sources: cited,
          source: "web" as const,
        };
      }
      // A partial-source failure can make the model ask for a choice even when
      // the listener requested playback. Let it reconsider once; never turn an
      // ambiguous proposal into playback without a new, validated selection.
      if (
        youtubeDailyQuota &&
        intent !== "browse" &&
        output.action === "keep" &&
        composition.size > 0 &&
        !clarifiedPartialIntent &&
        turn < MAX_ROUNDS - 1
      ) {
        clarifiedPartialIntent = true;
        messages.push({ role: "assistant", content: message.content ?? null });
        messages.push({
          role: "user",
          content: `L’intention de la demande est ${intent}. Le quota d’une source ne transforme pas cette demande en recherche de cartes. Une recherche ultérieure vide n’efface pas les candidats déjà trouvés dans les réponses précédentes. Si ces candidats correspondent à l’envie, renvoie une sélection partielle avec action=${intent} et trackIds pour l’exécuter. Garde keep seulement si une vraie ambiguïté musicale nécessite mon choix ou si aucun candidat ne convient. N’invente aucun titre.`,
        });
        continue;
      }
      if (
        intent === "browse" ||
        (output.action === "keep" &&
          (output.discoveryIds?.length || output.trackIds.length))
      ) {
        // Some providers still use the ordinary selection field. Preserve that
        // selection; never expand it to every retrieved candidate (which can
        // reintroduce titles the user explicitly excluded).
        const { cards } = composition.select(output);
        return {
          reply: cards.length
            ? withSourceNote(discoveryReply(cards, output.explanation))
            : emptyReply(),
          action: "keep" as const,
          tracks: [],
          discoveries: cards,
        };
      }
      const { action, ids } = composition.select(output);
      // A provider can override an MCP exclusion; the executable selection cannot.
      if (
        targetCount &&
        action !== "keep" &&
        ids.length < targetCount &&
        !expandedSelection &&
        turn < 3 &&
        toolCalls <= 6
      ) {
        expandedSelection = true;
        messages.push({ role: "assistant", content: message.content ?? null });
        messages.push({
          role: "user",
          content: `La sélection n’a que ${ids.length} nouveau(x) titre(s) admissible(s). Complète jusqu’à ${targetCount} avec une autre recherche compatible avec le morceau courant, sans reprendre les excludeIds. Renvoie la sélection totale dans l’ordre. Si le catalogue est insuffisant, garde seulement les titres vérifiés ; n’invente pas.`,
        });
        continue;
      }
      // External tracks come only from this turn's authoritative tool results.
      // Library-only turns still revalidate account ownership before playback.
      const tracks = externalSearch
        ? composition.tracks(ids)
        : await musicTracks(db, ids, userId);
      // Never announce a start when the provider supplied no executable selection.
      if (action !== "keep" && !tracks.length)
        throw new DjUnavailable(
          "Je n’ai pas obtenu de morceau à lancer. Choisis une carte proposée ou réessaie ; ta file est conservée.",
          502,
        );
      return {
        reply:
          tracks.length && action !== "keep"
            ? withSourceNote(
                selectionReply(action, tracks, targetCount, output.explanation),
              )
            : emptyReply(),
        action: tracks.length ? action : "keep",
        tracks,
        source: "mcp" as const,
      };
    }
    // A later empty search must not discard already validated candidates.
    return await partialSelection();
  } catch (error) {
    // A provider outage while expanding cannot erase a verified partial queue.
    // Cancellation, including the deadline, always wins over that recovery.
    if (composition.hasSelection && !timeout.aborted) {
      const partial = await partialSelection();
      if (partial.tracks.length) return partial;
    }
    if (error instanceof DjUnavailable) throw error;
    throw new DjUnavailable(
      "Le DJ est momentanément indisponible. Ta file de lecture est conservée.",
      502,
    );
  } finally {
    await mcp.close();
  }
}
