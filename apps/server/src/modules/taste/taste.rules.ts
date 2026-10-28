/**
 * How the listener's taste is read from their signals. Every weight, threshold and duration
 * lives here; the rest of the module only fetches signals and applies these functions.
 * Pure: no database, network or clock (the current time is a parameter).
 */
export const TASTE_RULES = {
  weights: {
    /** « J’aime »: an explicit like outweighs a dozen plays. */
    like: 4,
    /** Listened to at least once. */
    listened: 1,
    /** Per doubling of listens: 2 listens +1, 4 listens +2, 13 listens about +3.7. */
    replayDoubling: 1,
    /** Per skip within the first seconds, up to `maxEarlySkips`. */
    earlySkip: -2,
    /** « Je n’aime pas », before it fades. */
    dislike: -5,
  },
  /** A play counts as a listen when finished, or stopped after this long. */
  listenMs: 60_000,
  /** A skip before this point is a rejection; between the two it says nothing. */
  earlySkipMs: 30_000,
  maxEarlySkips: 3,
  /** « Souvent passé vite » needs at least this many early skips, and more than listens. */
  oftenSkipped: 2,
  /** « Je n’aime pas » hides the track this long, then its weight halves at the same pace. */
  dislikeDays: { default: 5, min: 1, max: 60 },
  /** Share of each ranked list kept for tracks the listener has no positive history with. */
  discoveryShare: 0.25,
  /** Listener-facing categories, from the score. */
  categories: { favourite: 5, frequent: 3 },
  /** Affinity 0–100 grows quickly at first, then flattens: 100 · (1 − e^(−score / scale)). */
  affinityScale: 4,
  /** An artist's taste is a mean shrunk toward zero by this many unheard tracks. */
  artistPrior: 3,
} as const;

const DAY_MS = 86_400_000;

export type TasteValue = "like" | "dislike";

/** What the server knows about one track for one listener. */
export interface TrackSignals {
  feedback?: { value: TasteValue; at: Date } | undefined;
  /** Finished plays, plus plays stopped after `listenMs`. Old plays without a time only count when finished. */
  listens: number;
  earlySkips: number;
}

export type TasteCategory =
  | "favourite"
  | "frequent"
  | "heard"
  | "unknown"
  | "unconvinced"
  | "hidden";

export interface Taste {
  score: number;
  /** A recent « Je n’aime pas »: left out of open proposals, still playable when asked for. */
  hidden: boolean;
  /** Whole days left before a hidden track may come back. */
  daysLeft?: number;
  category: TasteCategory;
  /** 0–100, shown under the category, never alone. */
  affinity: number;
  /** A short French summary for the DJ and the Library, e.g. « aimé · écouté 13 fois ». */
  label?: string;
}

export const NO_SIGNALS: TrackSignals = { listens: 0, earlySkips: 0 };

export const CATEGORY_TITLES: Record<TasteCategory, string> = {
  favourite: "Coup de cœur",
  frequent: "Souvent écouté",
  heard: "Déjà écouté",
  unknown: "Pas encore d’avis",
  unconvinced: "Peu accroché",
  hidden: "Écarté pour l’instant",
};

/** « Je n’aime pas » weighs fully while it hides the track, then halves every `days`. */
export function dislikeWeight(at: Date, now: Date, days: number) {
  const age = Math.max(0, now.getTime() - at.getTime()) / DAY_MS;
  if (age < days)
    return {
      weight: TASTE_RULES.weights.dislike,
      hidden: true,
      daysLeft: Math.ceil(days - age),
    };
  return {
    weight: TASTE_RULES.weights.dislike * 0.5 ** ((age - days) / days),
    hidden: false,
  };
}

export function tasteOf(signals: TrackSignals, now: Date, dislikeDays: number): Taste {
  const { weights } = TASTE_RULES;
  let score = 0;
  let hidden = false;
  let daysLeft: number | undefined;
  if (signals.feedback?.value === "like") score += weights.like;
  if (signals.feedback?.value === "dislike") {
    const dislike = dislikeWeight(signals.feedback.at, now, dislikeDays);
    score += dislike.weight;
    hidden = dislike.hidden;
    daysLeft = dislike.daysLeft;
  }
  if (signals.listens > 0) score += weights.listened;
  if (signals.listens > 1) score += weights.replayDoubling * Math.log2(signals.listens);
  score += weights.earlySkip * Math.min(signals.earlySkips, TASTE_RULES.maxEarlySkips);
  score = Math.round(score * 10) / 10;
  const label = tasteLabel(signals, hidden);
  return {
    score,
    hidden,
    ...(daysLeft === undefined ? {} : { daysLeft }),
    category: categoryOf(score, hidden, signals.feedback?.value === "like"),
    affinity: affinityOf(score),
    ...(label ? { label } : {}),
  };
}

function categoryOf(score: number, hidden: boolean, liked: boolean): TasteCategory {
  const { favourite, frequent } = TASTE_RULES.categories;
  if (hidden) return "hidden";
  if (liked || score >= favourite) return "favourite";
  if (score >= frequent) return "frequent";
  if (score > 0) return "heard";
  if (score < 0) return "unconvinced";
  return "unknown";
}

export function affinityOf(score: number) {
  return Math.round(100 * (1 - Math.exp(-Math.max(score, 0) / TASTE_RULES.affinityScale)));
}

function tasteLabel(signals: TrackSignals, hidden: boolean) {
  const parts: string[] = [];
  if (signals.feedback?.value === "like") parts.push("aimé");
  if (signals.feedback?.value === "dislike")
    parts.push(hidden ? "écarté récemment" : "écarté il y a un moment");
  if (signals.listens > 1) parts.push(`écouté ${signals.listens} fois`);
  else if (signals.listens === 1) parts.push("déjà écouté");
  if (
    signals.earlySkips >= TASTE_RULES.oftenSkipped &&
    signals.earlySkips > signals.listens
  )
    parts.push("souvent passé vite");
  return parts.join(" · ") || undefined;
}

export function clampDislikeDays(days: number) {
  const { min, max } = TASTE_RULES.dislikeDays;
  return Math.min(max, Math.max(min, Math.round(days)));
}

/**
 * Orders candidates for the DJ. An open search: hidden tracks leave, known favourites lead,
 * and one slot in `1 / discoveryShare` goes to a track without positive history; within each
 * group the incoming order is kept. A targeted search (an artist or a title the listener
 * named) keeps its order and its hidden tracks: taste only labels it.
 */
export function rankByTaste<T>(
  items: readonly T[],
  taste: (item: T) => Taste,
  options: { targeted?: boolean; share?: number } = {},
): T[] {
  if (options.targeted) return [...items];
  const share = options.share ?? TASTE_RULES.discoveryShare;
  const scored = items
    .map((item, order) => ({ item, order, taste: taste(item) }))
    .filter((entry) => !entry.taste.hidden);
  const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.taste.score - a.taste.score || a.order - b.order;
  const known = scored.filter((entry) => entry.taste.score > 0).sort(byScore);
  const discovery = scored.filter((entry) => entry.taste.score <= 0).sort(byScore);
  const ranked: T[] = [];
  for (let slot = 0; known.length || discovery.length; slot++) {
    const discoverySlot = Math.floor((slot + 1) * share) > Math.floor(slot * share);
    const next =
      (discoverySlot ? discovery : known).shift() ?? known.shift() ?? discovery.shift();
    if (next) ranked.push(next.item);
  }
  return ranked;
}

/**
 * One name per artist, as the Mac's TrackTitle reads it: the MusicBrainz primary credit, else
 * a « X - Topic » channel, else the « Artist - Song » title (main artist only, before feat.,
 * &, x or a comma), else the channel without its VEVO or Official suffix.
 */
export function artistName(track: {
  title?: string | null | undefined;
  channel?: string | null | undefined;
  musicMetadata?:
    | { status?: string; artists?: { name: string; role: string }[] }
    | null
    | undefined;
}): string | undefined {
  const credited =
    track.musicMetadata?.status === "matched"
      ? track.musicMetadata.artists?.find((artist) => artist.role === "primary")?.name
      : undefined;
  if (credited) return credited;
  const channel = track.channel?.trim() ?? "";
  if (/\s-\s*Topic$/i.test(channel)) return channel.replace(/\s*-\s*Topic$/i, "").trim() || undefined;
  const titled = /^(.+?)\s+[-–—]\s+\S/.exec(track.title ?? "")?.[1]
    ?.split(/\s+(?:feat\.?|ft\.?|featuring|x|&)\s+|,\s*/i)[0]
    ?.trim();
  if (titled) return titled;
  return channel.replace(/\s*(VEVO|Official|Officiel)$/i, "").trim() || undefined;
}

export interface ArtistTaste {
  name: string;
  tracks: number;
  listens: number;
  score: number;
  affinity: number;
}

/**
 * Artists ranked by the mean score of their tracks, shrunk toward zero by `artistPrior`
 * unheard tracks, so one liked song does not crown an artist.
 */
export function artistTastes(
  tracks: readonly { artist?: string | undefined; signals: TrackSignals; taste: Taste }[],
): ArtistTaste[] {
  const artists = new Map<string, { name: string; tracks: number; listens: number; total: number }>();
  for (const track of tracks) {
    if (!track.artist) continue;
    const key = track.artist.toLocaleLowerCase("fr");
    const artist = artists.get(key) ?? { name: track.artist, tracks: 0, listens: 0, total: 0 };
    artist.tracks += 1;
    artist.listens += track.signals.listens;
    artist.total += track.taste.score;
    artists.set(key, artist);
  }
  return [...artists.values()]
    .map(({ name, tracks: count, listens, total }) => {
      const score = Math.round((total / (count + TASTE_RULES.artistPrior)) * 10) / 10;
      return { name, tracks: count, listens, score, affinity: affinityOf(score) };
    })
    .filter((artist) => artist.score > 0)
    .sort((a, b) => b.score - a.score || b.listens - a.listens);
}
