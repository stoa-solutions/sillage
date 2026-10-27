import { parseDJIntent } from "../dj/intent.ts";

/** Matching uses catalog metadata, never inferred audio characteristics. */
export function normalizeMusic(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

interface MusicMetadata {
  title: string;
  channel?: string | null;
}
const filler = new Set([
  "de",
  "du",
  "des",
  "par",
  "et",
  "the",
  "a",
  "un",
  "une",
  "moi",
  "stp",
]);
function words(value: string): string[] {
  return normalizeMusic(value)
    .split(" ")
    .filter((w) => w && !filler.has(w));
}
function phrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}
export function versionPenalty(query: string, title: string): number {
  const q = normalizeMusic(query),
    t = normalizeMusic(title);
  let penalty = 0;
  for (const [pattern, cost] of [
    [/\b(type beat|karaoke|cover|tribute|reaction|tutorial)\b/, 35],
    [/\b(live|concert|colors show)\b/, 8],
    [/\b(mix|playlist|compilation|full album|full ep)\b/, 12],
    [/\b(remix|slowed|sped up)\b/, 6],
  ] as const) {
    if (pattern.test(t) && !pattern.test(q)) penalty += cost;
  }
  return penalty;
}

/** A complete artist + title match outranks a shared artist or description. */
export function musicMatchRank(query: string, track: MusicMetadata): number {
  const tokens = words(query);
  if (!tokens.length) return 0;
  const metadata = new Set(words(track.title + " " + (track.channel ?? "")));
  const coverage = tokens.filter((t) => metadata.has(t)).length / tokens.length;
  const exact = normalizeMusic(track.title) === normalizeMusic(query);
  return (
    (coverage === 1 ? 100 : coverage * 40) +
    (exact ? 10 : 0) -
    versionPenalty(query, track.title)
  );
}

function songTitle(title: string): string {
  const parts = title.split(/\s+[-–—]\s+/);
  return normalizeMusic(
    (parts.length > 1 ? parts.slice(1).join(" - ") : title)
      .replace(
        /\([^)]*(?:official|video|audio|lyrics|live|remaster)[^)]*\)/gi,
        "",
      )
      .replace(
        /\[[^\]]*(?:official|video|audio|lyrics|live|remaster)[^\]]*\]/gi,
        "",
      )
      .replace(/\[(?:4k|8k|1080p|hd|hq)\]/gi, "")
      .replace(/\s*\|.*$/, "")
      .replace(
        /\b(?:official music video|official video|official audio|lyrics video)\b/gi,
        "",
      ),
  );
}
function artistIdentity(track: MusicMetadata): string {
  const parts = track.title.split(/\s+[-–—]\s+/);
  return normalizeMusic(parts.length > 1 ? (parts[0] ?? "") : (track.channel ?? ""))
    .replace(/\b(topic|vevo)\b/g, "")
    .trim();
}

export interface RequestedTrack extends MusicMetadata {
  id: string;
}
export interface ExactRequest {
  tracks: RequestedTrack[];
  missing: string[];
  append: boolean;
}

/** Remove only scheduling syntax at the edges, never musical exclusions. */
function withoutPlaybackModifiers(part: string): string {
  let value = part.trim().replace(/^(?:dans cet ordre\s*:?\s*)/i, "")
    .replace(/^(?:maintenant|directement|tout de suite|imm[eé]diatement)\s+/i, "");
  const suffix = /(?:^|\s+)(?:maintenant|directement|tout de suite|imm[eé]diatement|[àa] la suite|[àa] suivre|(?:en|dans la) (?:file|queue)(?: d['’]attente)?|apr[eè]s (?:ce|le|la) (?:titre|morceau|chanson)|sans (?:couper|interrompre|changer)(?: (?:le morceau|la musique|la lecture|le titre)(?: actuel(?:le)?)?)?|dans cet ordre|stp|s['’]il te pla[iî]t)[.!?]*$/i;
  while (suffix.test(value)) value = value.replace(suffix, "").trim();
  return value.replace(/^[.!?]+$/, "");
}

function exactCandidates(part: string, catalog: RequestedTrack[]): RequestedTrack[] {
  const normalized = normalizeMusic(part);
  return catalog
    .filter((track) => {
      const title = songTitle(track.title);
      if (!title || !phrase(normalized, title)) return false;
      const metadata = new Set(
        words(track.title + " " + (track.channel ?? "")),
      );
      const requested = words(part);
      // Extra intent words ("similaire", "sans", etc.) must not silently disappear.
      return (
        requested.length > 0 &&
        requested.every((token) => metadata.has(token))
      );
    })
    .sort(
      (a, b) =>
        musicMatchRank(part, b) - musicMatchRank(part, a) ||
        a.title.length - b.title.length ||
        a.id.localeCompare(b.id),
    );
}

/** Resolve only explicit song references; mood/artist requests stay with the DJ. */
export function resolveExactRequest(
  message: string,
  catalog: RequestedTrack[],
): ExactRequest | null {
  const controls = parseDJIntent(message);
  if (controls.intent === "browse") return null;
  const ordered = /\b(?:puis|ensuite|suivi(?:e)? de|dans cet ordre)\b/i.test(
    message,
  );
  const command = /^(?:joue|mets|met|lance|ecoute|écoute|ajoute|play)\b/i.test(
    message.trim(),
  );
  const request = message
    .trim()
    .replace(
      /^(?:joue|mets|met|lance|ecoute|écoute|ajoute|play)(?:[- ]moi)?\s+/i,
      "",
    )
    .replace(/^(?:dans cet ordre\s*:?\s*)/i, "")
    .replace(/\s+(?:stp|s['’]il te pla[iî]t)[.!?]*$/i, "");
  const parts = (ordered
    ? request.split(/\s*\b(?:puis|ensuite|suivi(?:e)? de)\b\s*|\s*,\s*/i)
    : [request]).filter((part) => {
      if (withoutPlaybackModifiers(part)) return true;
      const title = normalizeMusic(part);
      // Empty separators cannot become song requests, even when catalog metadata
      // such as “[Official Video]” also normalizes to an empty song title.
      return title.length > 0 && catalog.some((track) => songTitle(track.title) === title);
    });
  if (!parts.length) return null;
  if (parts.length > 8)
    return {
      tracks: [],
      missing: ["Une demande est limitée à huit titres."],
      append: false,
    };
  const tracks: RequestedTrack[] = [],
    missing: string[] = [];
  let hadAmbiguity = false;
  for (const rawPart of parts) {
    // Preserve a real title such as “Maintenant” before interpreting that word as timing.
    const rawMatches = exactCandidates(rawPart, catalog);
    const part = rawMatches.length ? rawPart : withoutPlaybackModifiers(rawPart);
    const matches = rawMatches.length ? rawMatches : exactCandidates(part, catalog);
    const [first, second] = matches;
    const ambiguous =
      first !== undefined &&
      second !== undefined &&
      musicMatchRank(part, first) === musicMatchRank(part, second) &&
      artistIdentity(first) !== artistIdentity(second);
    hadAmbiguity ||= ambiguous;
    if (first && !ambiguous) tracks.push(first);
    else missing.push(part);
  }
  if (!ordered && !tracks.length && !hadAmbiguity) return null;
  if (ordered && !command && !tracks.length) return null;
  return { tracks, missing, append: controls.intent === "append" };
}
