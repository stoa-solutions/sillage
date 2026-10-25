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
          const result = await mcp.client.callTool(
            {
              name: call.function.name,
              arguments: args as Record<string, unknown>,
            },
            undefined,
            { signal: timeout },
          );
          const content = result.content as { type: string; text?: string }[];
          const text = content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          if (!result.isError && call.function.name === "library_search") {
            searched = true;
            const data = JSON.parse(text) as { tracks?: DjTrack[] };
            for (const track of data.tracks ?? [])
              candidates.set(track.id, track);
            for (const track of data.tracks ?? [])
              discoveries.set(track.id, { video: track, inLibrary: true });
          }
          if (!result.isError && call.function.name === "youtube_search") {
            searched = true;
            const data = JSON.parse(text) as {
              results?: { video: DjTrack; inLibrary: boolean }[];
            };
            for (const item of data.results ?? []) {
              discoveries.set(item.video.id, item);
              candidates.set(item.video.id, item.video);
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: text.slice(0, 20000),
          });
        }
        continue;
      }
      // Some providers ignore required tool choice. One bounded reminder avoids
      // declaring music absent without ever searching the catalog.
      if (!searched && turn < MAX_ROUNDS - 1) {
        messages.push({ role: "assistant", content: message.content ?? "" });
        messages.push({
          role: "user",
          content:
            "Cherche les indices de ma demande avec library_search ou youtube_search avant de conclure ou de demander un titre exact. Propose les candidats vérifiés si plusieurs conviennent.",
        });
        continue;
      }
      if (!searched)
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
        return {
          reply: ids.length
            ? `Je te propose ${ids.length === 1 ? "ce morceau" : `ces ${ids.length} morceaux`}. Choisis celui que tu veux écouter.`
            : output.reply,
          action: "keep" as const,
          tracks: [],
          discoveries: ids.map((id) => discoveries.get(id)!),
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
              (id) => !avoidRepeats || !input.excludeIds.includes(id),
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
            ? selectionReply(action, tracks, targetCount)
            : output.reply,
        action: tracks.length ? action : "keep",
        tracks,
        source: "mcp" as const,
      };
    }
    // Never throw away an already validated partial selection while looking for more.
    const tracks = externalSearch
      ? partialIds.slice(0, targetCount ?? 8).map((id) => candidates.get(id)!)
      : await musicTracks(db, partialIds.slice(0, targetCount ?? 8), userId);
    return {
      action: tracks.length ? ("append" as const) : ("keep" as const),
      tracks,
      reply: tracks.length
        ? selectionReply("append", tracks, targetCount)
        : "Je n’ai pas trouvé de nouvelle sélection compatible dans les sources choisies. Ta file est conservée ; tu peux préciser ton envie ou élargir la recherche.",
      source: "mcp" as const,
    };
  } catch (error) {
    if (error instanceof DjUnavailable) throw error;
    throw new DjUnavailable(
      "Le DJ est momentanément indisponible. Ta file de lecture est conservée.",
      502,
    );
  } finally {
    await mcp.close();
  }
}
