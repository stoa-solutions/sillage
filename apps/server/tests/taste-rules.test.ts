import { expect, it } from "vitest";
import {
  affinityOf,
  artistName,
  artistTastes,
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
const taste = (score: number, hidden = false): Taste => ({
  score,
  hidden,
  category: "unknown",
  affinity: 0,
});

it("hides a dislike for the account's delay, then halves its weight at the same pace", () => {
  expect(dislikeWeight(daysAgo(1), now, 5)).toEqual({ weight: -5, hidden: true, daysLeft: 4 });
  expect(dislikeWeight(daysAgo(5), now, 5)).toEqual({ weight: -5, hidden: false });
  expect(dislikeWeight(daysAgo(10), now, 5).weight).toBeCloseTo(-2.5);
  expect(dislikeWeight(daysAgo(15), now, 5).weight).toBeCloseTo(-1.25);
  expect(dislikeWeight(daysAgo(10), now, 30).hidden).toBe(true);
});

it("lets an explicit like outweigh a dozen listens", () => {
  const liked = tasteOf({ ...NO_SIGNALS, feedback: { value: "like", at: daysAgo(1) } }, now, 5);
  const played = tasteOf({ listens: 13, earlySkips: 0 }, now, 5);
  expect(liked.score).toBeGreaterThanOrEqual(TASTE_RULES.weights.like);
  expect(played.score).toBeCloseTo(1 + Math.log2(13), 1);
  expect(liked.category).toBe("favourite");
  expect(played.category).toBe("frequent");
  expect(played.label).toBe("écouté 13 fois");
});

it("reads skips only when they say something", () => {
  // One early skip is not « souvent passé vite »; two with no listen are.
  expect(tasteOf({ listens: 0, earlySkips: 1 }, now, 5).label).toBeUndefined();
  const skipped = tasteOf({ listens: 0, earlySkips: 2 }, now, 5);
  expect(skipped).toMatchObject({ score: -4, category: "unconvinced", label: "souvent passé vite" });
  // Early skips count up to the cap.
  expect(tasteOf({ listens: 0, earlySkips: 9 }, now, 5).score).toBe(
    TASTE_RULES.weights.earlySkip * TASTE_RULES.maxEarlySkips,
  );
});

it("describes a hidden track without emoji, with the days left", () => {
  const hidden = tasteOf(
    { listens: 2, earlySkips: 0, feedback: { value: "dislike", at: daysAgo(2) } },
    now,
    5,
  );
  expect(hidden).toMatchObject({ hidden: true, daysLeft: 3, category: "hidden" });
  expect(hidden.label).toBe("écarté récemment · écouté 2 fois");
  expect(hidden.label).not.toMatch(/\p{Extended_Pictographic}/u);
});

it("maps the score to a 0–100 affinity that rises fast then flattens", () => {
  expect(affinityOf(-3)).toBe(0);
  expect(affinityOf(0)).toBe(0);
  expect(affinityOf(1)).toBe(22);
  expect(affinityOf(4)).toBe(63);
  expect(affinityOf(10)).toBe(92);
});

it("bounds the per-account delay", () => {
  expect(clampDislikeDays(0)).toBe(TASTE_RULES.dislikeDays.min);
  expect(clampDislikeDays(400)).toBe(TASTE_RULES.dislikeDays.max);
  expect(clampDislikeDays(7.4)).toBe(7);
});

it("orders an open search: hidden out, favourites first, one slot in four for discovery", () => {
  const tastes: Record<string, Taste> = {
    a: taste(0),
    b: taste(5),
    c: taste(0),
    d: taste(2),
    e: taste(-5, true),
    f: taste(4),
    g: taste(1),
    h: taste(-2),
  };
  const ranked = rankByTaste(Object.keys(tastes), (id) => tastes[id]!);
  expect(ranked).toEqual(["b", "f", "d", "a", "g", "c", "h"]);
});

it("keeps a targeted search in its own order, hidden tracks included", () => {
  const tastes: Record<string, Taste> = { exact: taste(0), loved: taste(6), gone: taste(-5, true) };
  expect(rankByTaste(Object.keys(tastes), (id) => tastes[id]!, { targeted: true })).toEqual([
    "exact",
    "loved",
    "gone",
  ]);
});

it("names artists by their MusicBrainz credit, the Topic channel, the title, then the channel", () => {
  expect(
    artistName({
      title: "Mr. Rager",
      channel: "KidCudiVEVO",
      musicMetadata: { status: "matched", artists: [{ name: "Kid Cudi", role: "primary" }] },
    }),
  ).toBe("Kid Cudi");
  expect(artistName({ title: "Never Be Like You", channel: "Flume - Topic" })).toBe("Flume");
  // Channels that are not the artist: the title says who sings.
  expect(
    artistName({ title: "Elvis Presley - In The Ghetto (Music Video) (1969)", channel: "gaaronpresley" }),
  ).toBe("Elvis Presley");
  expect(
    artistName({ title: "Jewel Usain feat. Béesau & Hedges - Incapable (Clip officiel)", channel: "Jewel Usain" }),
  ).toBe("Jewel Usain");
  expect(artistName({ title: "Полина Гагарина - Кукушка", channel: "StarPro" })).toBe("Полина Гагарина");
  expect(artistName({ title: "Beds Are Burning", channel: "MidnightOilVEVO" })).toBe("MidnightOil");
  expect(artistName({ title: "Sans tiret", channel: null })).toBeUndefined();
});

it("does not crown an artist for a single liked track", () => {
  const entry = (artist: string, score: number, listens = 1) => ({
    artist,
    signals: { listens, earlySkips: 0 },
    taste: taste(score),
  });
  const artists = artistTastes([
    entry("One Hit", 5),
    entry("Regular", 3, 4),
    entry("Regular", 3, 4),
    entry("Regular", 3, 4),
    entry("Skipped", -4, 0),
  ]);
  expect(artists.map((artist) => artist.name)).toEqual(["Regular", "One Hit"]);
  expect(artists[0]).toMatchObject({ tracks: 3, listens: 12, score: 1.5 });
});
