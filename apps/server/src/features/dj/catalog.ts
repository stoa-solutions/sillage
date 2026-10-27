import type { Database } from "../../db/index.ts";
import { musicTracks, requestedTracks } from "../../music-mcp.ts";
import type { DjInput } from "./contracts.ts";
import type { TurnPlan } from "./plan.ts";

/** Resolve explicit titles without spending a model request; preserve order and ownership. */
export async function catalogSelection(
  db: Database,
  input: DjInput,
  userId: string,
  plan: TurnPlan,
) {
  const { externalSearch, relative, intent } = plan;
  const requested =
    externalSearch ||
    relative ||
    intent === "browse" ||
    /\bplaylist\b/i.test(input.message)
      ? null
      : await requestedTracks(db, input.message, userId);
  if (requested) {
    // A rejected suggestion is a search clue, never an implicit replay request.
    // Let the DJ explore alternatives rather than partially changing an ordered set.
    if (requested.tracks.some((track) => input.rejectedIds.includes(track.id))) return null;
    if (requested.missing.length)
      return {
        reply: `Je n’ai pas identifié précisément : ${requested.missing.join(" ; ")}. Précise le titre ou l’artiste ; je garde ta file actuelle.`,
        action: "keep" as const,
        tracks: [],
        source: "catalog" as const,
      };
    const tracks = await musicTracks(
      db,
      requested.tracks.map((t) => t.id),
      userId,
    );
    if (tracks.length !== requested.tracks.length)
      return {
        reply:
          "Un des titres n’est plus disponible. Je garde ta file actuelle.",
        action: "keep" as const,
        tracks: [],
        source: "catalog" as const,
      };
    // The turn policy is the sole playback authority, including on this fast path.
    // Matching identifies titles and order; it must not reinterpret the timing.
    const append = intent === "append";
    return {
      reply: `${append ? "J’ajoute à la suite" : "C’est parti"} : ${tracks.map((t) => t.title).join(", puis ")}.`,
      action: append ? ("append" as const) : ("replace" as const),
      tracks,
      source: "catalog" as const,
    };
  }
  return null;
}
