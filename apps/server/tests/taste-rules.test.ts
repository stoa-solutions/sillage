import { expect, it } from "vitest";
import {
  clampDislikeDays,
  dislikeWeight,
  NO_SIGNALS,
  rankByTaste,
  TASTE_RULES,
  tasteOf,
  type Taste,
} from "../src/modules/taste/taste.rules.ts";

const now = new Date("2026-10-28T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

it("hides a 👎 for the account's delay, then halves its weight at the same pace", () => {
  expect(dislikeWeight(daysAgo(1), now, 5)).toEqual({ weight: -5, hidden: true });
  expect(dislikeWeight(daysAgo(5), now, 5)).toEqual({ weight: -5, hidden: false });
  expect(dislikeWeight(daysAgo(10), now, 5).weight).toBeCloseTo(-2.5);
  expect(dislikeWeight(daysAgo(15), now, 5).weight).toBeCloseTo(-1.25);
  // Another account's delay changes only the pace.
  expect(dislikeWeight(daysAgo(10), now, 30).hidden).toBe(true);
});

it("scores a track from its signals, with a label the DJ can read", () => {
  expect(tasteOf(NO_SIGNALS, now, 5)).toEqual({ score: 0, hidden: false });
  const favourite = tasteOf(
    { plays: 13, finished: 9, earlySkips: 0, feedback: { value: "like", at: daysAgo(2) } },
    now,
    5,
  );
  expect(favourite.score).toBeCloseTo(3 + 1 + Math.log2(13), 1);
  expect(favourite.label).toBe("aimé · écouté 13 fois");
  const skipped = tasteOf({ plays: 5, finished: 0, earlySkips: 5 }, now, 5);
  // Early skips count up to the cap, replays still count a little.
  expect(skipped.score).toBeCloseTo(-2 * TASTE_RULES.maxEarlySkips + Math.log2(5), 1);
  expect(skipped.label).toContain("souvent passé vite");
  const disliked = tasteOf(
    { ...NO_SIGNALS, feedback: { value: "dislike", at: daysAgo(1) } },
    now,
    5,
  );
  expect(disliked).toMatchObject({ hidden: true, label: "écarté récemment (👎)" });
});

it("bounds the per-account delay", () => {
  expect(clampDislikeDays(0)).toBe(TASTE_RULES.dislikeDays.min);
  expect(clampDislikeDays(400)).toBe(TASTE_RULES.dislikeDays.max);
  expect(clampDislikeDays(7.4)).toBe(7);
});

it("drops hidden tracks, puts favourites first and keeps one slot in four for discovery", () => {
  const tastes: Record<string, Taste> = {
    a: { score: 0, hidden: false },
    b: { score: 5, hidden: false },
    c: { score: 0, hidden: false },
    d: { score: 2, hidden: false },
    e: { score: -5, hidden: true },
    f: { score: 4, hidden: false },
    g: { score: 1, hidden: false },
    h: { score: -2, hidden: false },
  };
  const ranked = rankByTaste(Object.keys(tastes), (id) => tastes[id]!);
  expect(ranked).not.toContain("e");
  // Known by score: b f d g. Discovery keeps search order, penalties last: a c h.
  expect(ranked).toEqual(["b", "f", "d", "a", "g", "c", "h"]);
});

it("keeps the search order when nothing is known, and fills with what remains", () => {
  const none = (): Taste => ({ score: 0, hidden: false });
  expect(rankByTaste(["x", "y", "z"], none)).toEqual(["x", "y", "z"]);
  const liked = (): Taste => ({ score: 1, hidden: false });
  expect(rankByTaste(["x", "y", "z", "w", "v"], liked)).toEqual(["x", "y", "z", "w", "v"]);
});
