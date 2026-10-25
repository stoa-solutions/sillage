import {
  searchFailureSummary,
  type SearchFailure,
} from "../../search-feedback.ts";
import {
  readToolEvidence,
  discoveryReply,
  noSelectionReply,
} from "./evidence.ts";
import type { InformationSource } from "../../information.ts";
import { selectionReply } from "../../dj-selection.ts";
import { playbackAction } from "../../dj-intent.ts";
import { LEGACY_USER } from "../../accounts.ts";
import { djConfig, type DjConfig } from "../../dj-config.ts";
import type { Database } from "../../db.ts";
import { connectMusicMcp, musicTracks, type DjTrack } from "../../music-mcp.ts";
import { selection, type DjInput, type Selection } from "./contracts.ts";
import { DjUnavailable } from "./errors.ts";
import { reserveDj } from "./quota.ts";
import { catalogSelection } from "./catalog.ts";
import { planTurn, initialMessages } from "./context.ts";
import { completeTurn, MAX_ROUNDS, type ChatTool } from "./provider.ts";

/** Bounded orchestration: gather evidence, validate selection, then return an operation. */
export async function djTurn(
  db: Database,
  input: DjInput,
  signal?: AbortSignal,
  config: DjConfig = djConfig(),
  userId = LEGACY_USER,
) {
  const plan = planTurn(input);
  const { intent, targetCount, avoidRepeats, externalSearch } = plan;
  const requested = await catalogSelection(db, input, userId, plan);
  if (requested) return requested;
  let expandedSelection = false;
  let partialIds: string[] = [];
  if (!config.configured)
    throw new DjUnavailable(
      "Le mode DJ attend la configuration de son IA côté serveur. Ta bibliothèque reste disponible.",
    );
  await reserveDj(db, userId);
  const mcp = await connectMusicMcp(
    db,
    input.excludeIds,
    userId,
    externalSearch,
    plan.scope,
    input.rejectedIds,
  );
  const candidates = new Map<string, DjTrack>();
  const discoveries = new Map<string, { video: DjTrack; inLibrary: boolean }>();
  const messages = initialMessages(input, plan);
  const timeout = AbortSignal.any([
    AbortSignal.timeout(90000),
    ...(signal ? [signal] : []),
  ]);
  let toolCalls = 0;
  let searched = false;
  let informationRequested = false;
  const information = new Map<number, InformationSource>();
  let informationFailed = false;
  let informationNotice = "";
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
    const tracks = externalSearch
      ? partialIds.slice(0, targetCount ?? 8).map((id) => candidates.get(id)!)
      : await musicTracks(db, partialIds.slice(0, targetCount ?? 8), userId);
    timeout.throwIfAborted();
    return {
      action: tracks.length ? ("append" as const) : ("keep" as const),
      tracks,
      reply: tracks.length
        ? withSourceNote(selectionReply("append", tracks, targetCount))
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
      try {
        const result = await mcp.client.callTool(
          { name, arguments: args },
          undefined,
          { signal: timeout },
        );
        const evidence = readToolEvidence(name, result);
        text = evidence.text;
        if (name === "seekInformation") {
          informationRequested = true;
          const data = JSON.parse(text);
          informationFailed = data.status !== "ok";
          informationNotice = data.notice ?? "";
          const sources = (data.sources as InformationSource[]).map(
            (source) => ({ ...source, id: information.size + source.id }),
          );
          for (const source of sources) information.set(source.id, source);
          text = JSON.stringify({
            status: data.status,
            notice: informationNotice,
            sources,
          });
        }
        for (const item of evidence.items) {
          candidates.set(item.video.id, item.video);
          discoveries.set(item.video.id, item);
        }
        if (evidence.isSearch) searched = true;
        failedSearches += evidence.failedSources;
        if (evidence.isSearch) failures.delete("search");
        for (const source of evidence.recoveredSources) failures.delete(source);
        for (const failure of evidence.failures)
          failures.set(failure.source, failure);
        youtubeDailyQuota ||= evidence.youtubeDailyQuota;
        visualUnsupported ||= evidence.visualUnsupported;
      } catch (error) {
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
      messages.push({ role: "tool", tool_call_id: id, content: text });
    }
    for (let turn = 0; turn < MAX_ROUNDS; turn++) {
      const message = await completeTurn(
        config,
        messages,
        tools,
        turn,
        timeout,
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
        if (searched && !candidates.size && !reformulated && toolCalls < 8) {
          reformulated = true;
          messages.push({
            role: "user",
            content:
              "La recherche n’a pas fourni de nouveau candidat. Repars du mot musical employé par l’utilisateur, seul, sans ajouter playlist ou plusieurs genres dans la même requête. Essaie ensuite une graphie ou un genre pertinent séparément. Une source en erreur ne rend pas les autres sources indisponibles. Si YouTube indique daily_quota, explore la bibliothèque autorisée avec des requêtes courtes ; ne demande pas à l’utilisateur de répéter son envie. Respecte les exclusions de la demande et les cartes rejetées. Si les sources restent sans résultat, conserve la lecture.",
          });
        }
        continue;
      }
      // Some providers ignore required tool choice. One bounded reminder avoids
      // declaring music absent without ever searching the catalog.
      if (!searched && !informationRequested && turn < MAX_ROUNDS - 1) {
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
      let output: Selection;
      try {
        output = selection.parse(JSON.parse(message.content ?? ""));
      } catch {
        throw new DjUnavailable(
          "Le DJ n’a pas renvoyé une sélection lisible. Réessaie.",
          502,
        );
      }
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
              ? output.reply +
                (informationNotice ? " " + informationNotice : "")
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
        candidates.size > 0 &&
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
        const ids = output.discoveryIds?.length
          ? output.discoveryIds
          : output.trackIds;
        if (ids.some((id) => !discoveries.has(id)))
          throw new DjUnavailable(
            "Résultat de découverte non vérifié. Réessaie.",
            502,
          );
        const cards = [...new Set(ids)]
          .filter((id) => !input.rejectedIds.includes(id))
          .map((id) => discoveries.get(id)!);
        return {
          reply: cards.length
            ? withSourceNote(discoveryReply(cards))
            : emptyReply(),
          action: "keep" as const,
          tracks: [],
          discoveries: cards,
        };
      }
      if (output.trackIds.some((id) => !candidates.has(id)))
        throw new DjUnavailable(
          "La sélection du DJ contenait un titre non vérifié. Réessaie.",
          502,
        );
      const action = playbackAction(intent, output.action);
      const ids =
        action === "keep"
          ? []
          : [...new Set(output.trackIds)].filter(
              (id) =>
                !input.rejectedIds.includes(id) &&
                (!avoidRepeats || !input.excludeIds.includes(id)),
            );
      if (action === "append" && ids.length > partialIds.length)
        partialIds = ids;
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
        ? ids.slice(0, targetCount ?? 8).map((id) => candidates.get(id)!)
        : await musicTracks(db, ids.slice(0, targetCount ?? 8), userId);
      // Never announce a start when the provider supplied no executable selection.
      if (action !== "keep" && !tracks.length)
        throw new DjUnavailable(
          "Je n’ai pas obtenu de morceau à lancer. Choisis une carte proposée ou réessaie ; ta file est conservée.",
          502,
        );
      return {
        reply:
          tracks.length && action !== "keep"
            ? withSourceNote(selectionReply(action, tracks, targetCount))
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
    if (partialIds.length && !timeout.aborted) {
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
