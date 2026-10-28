/**
 * How the listener's taste is read from their signals. Every weight, threshold and duration
 * lives here; the rest of the module only fetches signals and applies these functions.
 * Pure: no database, network or clock (the current time is a parameter).
 */
export const TASTE_RULES = {
  weights: {
    /** A 👍 on the track. */
    like: 3,
    /** The track was played to the end at least once. */
    finished: 1,
    /** Per doubling of plays: 2 plays +1, 4 plays +2, 13 plays about +3.7. */
    replayDoubling: 1,
    /** Per skip within the first seconds, up to `maxEarlySkips`. */
    earlySkip: -2,
    /** A 👎, before it fades. */
    dislike: -5,
  },
  /** A skip before this point is a rejection; a later one is only « next ». */
  earlySkipMs: 30_000,
  maxEarlySkips: 3,
  /** A 👎 hides the track this long, then its weight halves at the same pace. Per account. */
  dislikeDays: { default: 5, min: 1, max: 60 },
  /** Share of each ranked list kept for tracks the listener has no positive history with. */
  discoveryShare: 0.25,
} as const;

const DAY_MS = 86_400_000;

export type TasteValue = "like" | "dislike";

/** What the server knows about one track for one listener. */
export interface TrackSignals {
  feedback?: { value: TasteValue; at: Date } | undefined;
  /** Plays that ended by finishing or skipping (a queue replaced by the DJ is not a play). */
  plays: number;
  finished: number;
  earlySkips: number;
}

export interface Taste {
  score: number;
  /** A recent 👎: left out of proposals, still playable when asked for by name. */
  hidden: boolean;
  /** A short French summary for the DJ, e.g. « aimé · écouté 13 fois ». */
  label?: string;
}

export const NO_SIGNALS: TrackSignals = { plays: 0, finished: 0, earlySkips: 0 };

/** A 👎 weighs fully while it hides the track, then halves every `days`. */
export function dislikeWeight(at: Date, now: Date, days: number) {
  const age = Math.max(0, now.getTime() - at.getTime()) / DAY_MS;
  if (age < days) return { weight: TASTE_RULES.weights.dislike, hidden: true };
  return {
    weight: TASTE_RULES.weights.dislike * 0.5 ** ((age - days) / days),
    hidden: false,
  };
}

export function tasteOf(signals: TrackSignals, now: Date, dislikeDays: number): Taste {
  const { weights } = TASTE_RULES;
  let score = 0;
  let hidden = false;
  if (signals.feedback?.value === "like") score += weights.like;
  if (signals.feedback?.value === "dislike") {
    const dislike = dislikeWeight(signals.feedback.at, now, dislikeDays);
    score += dislike.weight;
    hidden = dislike.hidden;
  }
  if (signals.finished > 0) score += weights.finished;
  if (signals.plays > 1) score += weights.replayDoubling * Math.log2(signals.plays);
  score += weights.earlySkip * Math.min(signals.earlySkips, TASTE_RULES.maxEarlySkips);
  const label = tasteLabel(signals, hidden);
  return { score: Math.round(score * 10) / 10, hidden, ...(label ? { label } : {}) };
}

function tasteLabel(signals: TrackSignals, hidden: boolean) {
  const parts: string[] = [];
  if (signals.feedback?.value === "like") parts.push("aimé");
  if (signals.feedback?.value === "dislike")
    parts.push(hidden ? "écarté récemment (👎)" : "écarté il y a un moment (👎)");
  if (signals.plays > 1) parts.push(`écouté ${signals.plays} fois`);
  else if (signals.finished > 0) parts.push("déjà écouté en entier");
  if (signals.earlySkips > 0 && signals.earlySkips >= signals.finished)
    parts.push("souvent passé vite");
  return parts.join(" · ") || undefined;
}

export function clampDislikeDays(days: number) {
  const { min, max } = TASTE_RULES.dislikeDays;
  return Math.min(max, Math.max(min, Math.round(days)));
}

/**
 * Orders candidates for the DJ: hidden tracks leave, known favourites lead, and one slot in
 * `1 / discoveryShare` goes to a track without positive history, so taste never closes the
 * door on discovery. Within each group the search's own relevance order is kept.
 */
export function rankByTaste<T>(
  items: readonly T[],
  taste: (item: T) => Taste,
  share: number = TASTE_RULES.discoveryShare,
): T[] {
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
    const next = (discoverySlot ? discovery : known).shift() ?? (known.shift() ?? discovery.shift());
    if (next) ranked.push(next.item);
  }
  return ranked;
}
