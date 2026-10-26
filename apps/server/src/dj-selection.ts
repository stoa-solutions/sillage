import type { DjTrack } from "./music-mcp.ts";

/** Announce the validated operation, not a provider promise the queue may contradict. */
export function selectionReply(
  action: "replace" | "append",
  tracks: DjTrack[],
  targetCount?: number,
  explanation?: string,
): string {
  const titles = tracks
    .slice(0, 3)
    .map((t) => t.title)
    .join(", puis ");
  const rest =
    tracks.length > 3
      ? ` et ${tracks.length - 3} autre${tracks.length === 4 ? " titre" : "s titres"}`
      : "";
  const partial =
    targetCount && tracks.length < targetCount
      ? ` Je n’ai trouvé que ${tracks.length} nouveau${tracks.length === 1 ? " titre compatible" : "x titres compatibles"} sur les ${targetCount} demandés.`
      : "";
  const operation =
    action === "append"
      ? `J’ajoute à la suite : ${titles}${rest}.${partial}`
      : `C’est parti : ${titles}${rest}.`;
  return explanation?.trim() ? `${operation} ${explanation.trim()}` : operation;
}
