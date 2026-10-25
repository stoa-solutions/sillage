import type { DjTrack } from "./music-mcp.ts";

/** Announce the validated operation, not a provider promise the queue may contradict. */
export function selectionReply(action: "replace" | "append", tracks: DjTrack[], targetCount?: number): string {
  const titles = tracks.slice(0, 3).map(t => t.title).join(", puis ");
  const rest = tracks.length > 3 ? ` et ${tracks.length - 3} autres titres` : "";
  const partial = targetCount && tracks.length < targetCount ? ` Je n’ai trouvé que ${tracks.length} nouveau(x) titre(s) compatible(s) sur les ${targetCount} demandés.` : "";
  return action === "append"
    ? `J’ajoute à la suite : ${titles}${rest}.${partial}`
    : `C’est parti : ${titles}${rest}.`;
}
