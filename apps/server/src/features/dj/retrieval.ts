/** Identity lookup and musical alternatives are separate clues, never one accidental AND filter. */
export function musicQueries(input: {
  query: string;
  artist?: string;
  alternatives?: string[];
  mode?: string;
}): string[] {
  if (input.mode === "image") return [input.query];
  const values = [
    input.artist?.trim() || input.query,
    ...(input.alternatives ?? []),
  ];
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

/** Unknown music metadata stays eligible; obvious non-musical formats are not mood recommendations. */
export function isMusicCandidate(
  query: string,
  video: { title: string; musicMetadata?: { status?: string } | null },
): boolean {
  if (video.musicMetadata?.status === "matched") return true;
  const nonMusic =
    /\b(tutorial|tuto|(?:guitar|piano|drums?|bass|singing) lesson|learn (?:how|three\.?js|javascript|python)|cours de|podcast|documentaire|conference|programme.*musculation)\b/i;
  return (
    nonMusic.test(query) ||
    !nonMusic.test(video.title.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
  );
}

/** Preserve each clue's ranking without letting the first one hide every other clue. */
export function interleaveClues<T>(groups: T[][]): T[] {
  const result: T[] = [];
  for (
    let index = 0;
    index < Math.max(0, ...groups.map((group) => group.length));
    index++
  )
    for (const group of groups)
      if (group[index] !== undefined) result.push(group[index]);
  return result;
}
