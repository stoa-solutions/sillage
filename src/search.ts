import type { Membership, SearchFilters, SearchResult, Video } from "./types";

export function parseQuery(query: string): {
  text: string;
  minDuration?: number;
  maxDuration?: number;
} {
  const result: { text: string; minDuration?: number; maxDuration?: number } = {
    text: "",
  };
  const pattern =
    /(?:\bde\s+)?(plus\s+d[e']\s*|moins\s+d[e']\s*|over\s+|under\s+|>|<)\s*(une?|\d+(?:[.,]\d+)?)\s*(heures?|hours?|h\b|minutes?|mins?\b)/gi;
  result.text = query
    .replace(/[’‘]/g, "'")
    .replace(pattern, (_all, operator: string, count: string, unit: string) => {
      const n = /^un/i.test(count) ? 1 : Number(count.replace(",", "."));
      const seconds = n * (/^(h|hour|heure)/i.test(unit) ? 3600 : 60);
      if (/plus|over|>/i.test(operator))
        result.minDuration = Math.max(result.minDuration ?? 0, seconds);
      else
        result.maxDuration = Math.min(result.maxDuration ?? Infinity, seconds);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return result;
}

const STOP = new Set(
  "a au aux avec ce ces dans de des du en et for from i il je la le les ma mes mon music musique of on ou par pour que qui sa se ses sur the to un une video videos youtube".split(
    " ",
  ),
);
export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((t) => t.length > 1 && !STOP.has(t));
}

export function searchLibrary(
  videos: Video[],
  memberships: Membership[],
  query: string,
  filters: SearchFilters,
  vectors = new Map<string, number[]>(),
  queryVector?: number[],
): SearchResult[] {
  const parsed = parseQuery(query);
  const min = Math.max(
    filters.minDuration ?? -Infinity,
    parsed.minDuration ?? -Infinity,
  );
  const max = Math.min(
    filters.maxDuration ?? Infinity,
    parsed.maxDuration ?? Infinity,
  );
  const filteredMemberships = new Map<string, Membership[]>();
  for (const m of memberships) {
    if (filters.playlistId && m.playlistId !== filters.playlistId) continue;
    const group = filteredMemberships.get(m.videoId) ?? [];
    group.push(m);
    filteredMemberships.set(m.videoId, group);
  }
  const candidates = videos.filter(
    (v) =>
      filteredMemberships.has(v.id) &&
      ((min === -Infinity && max === Infinity) ||
        (v.durationSeconds !== null &&
          v.durationSeconds > min &&
          v.durationSeconds < max)),
  );
  const terms = [...new Set(tokenize(parsed.text))];
  const activeQuery = parsed.text.trim().length > 0;
  const lexical: { id: string; score: number }[] = [];
  if (terms.length) {
    const documents = candidates.map((v) => ({
      id: v.id,
      tokens: tokenize(
        `${v.title ?? ""} ${v.title ?? ""} ${v.channel ?? ""} ${v.tags.join(" ")} ${v.description.slice(0, 1000)}`,
      ),
    }));
    const average =
      documents.reduce((n, d) => n + d.tokens.length, 0) /
        Math.max(documents.length, 1) || 1;
    const frequency = new Map(
      terms.map((t) => [
        t,
        documents.filter((d) => d.tokens.includes(t)).length,
      ]),
    );
    for (const doc of documents) {
      let score = 0;
      for (const term of terms) {
        const count = doc.tokens.filter((t) => t === term).length;
        if (!count) continue;
        const idf = Math.log(
          1 +
            (documents.length - frequency.get(term)! + 0.5) /
              (frequency.get(term)! + 0.5),
        );
        score +=
          (idf * count * 2.2) /
          (count + 1.2 * (0.25 + (0.75 * doc.tokens.length) / average));
      }
      if (score > 0) lexical.push({ id: doc.id, score });
    }
    lexical.sort((a, b) => b.score - a.score);
  }
  const semantic: { id: string; score: number }[] = [];
  if (queryVector?.length && activeQuery) {
    for (const v of candidates) {
      const vector = vectors.get(v.id);
      if (!vector || vector.length !== queryVector.length) continue;
      let dot = 0,
        aa = 0,
        bb = 0;
      for (let i = 0; i < vector.length; i++) {
        const a = vector[i]!,
          b = queryVector[i]!;
        dot += a * b;
        aa += a ** 2;
        bb += b ** 2;
      }
      const score = dot / Math.sqrt(aa * bb);
      if (Number.isFinite(score)) semantic.push({ id: v.id, score });
    }
    semantic.sort((a, b) => b.score - a.score);
  }
  const scores = new Map<string, number>();
  for (const rank of [lexical, semantic])
    rank
      .slice(0, 200)
      .forEach((item, index) =>
        scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (60 + index + 1)),
      );
  const semanticIds = new Set(semantic.slice(0, 200).map((v) => v.id));
  const results = candidates
    .filter((v) => !activeQuery || scores.has(v.id))
    .map((video) => ({
      video,
      memberships: filteredMemberships.get(video.id)!,
      score: scores.get(video.id) ?? 0,
      semantic: semanticIds.has(video.id),
    }));
  return results.sort((a, b) => {
    if (filters.sort === "duration")
      return (b.video.durationSeconds ?? -1) - (a.video.durationSeconds ?? -1);
    if (activeQuery && filters.sort !== "position" && b.score !== a.score)
      return b.score - a.score;
    return (
      Math.min(...a.memberships.map((m) => m.position)) -
      Math.min(...b.memberships.map((m) => m.position))
    );
  });
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Durée inconnue";
  const s = Math.floor(seconds);
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
