import { describe, expect, it } from "vitest";
import { musicMatchRank, resolveExactRequest } from "../src/music-matching.ts";

const catalog = [
  {
    id: "navajo-live",
    title: "Masego - Navajo | A COLORS SHOW",
    channel: "COLORS",
  },
  { id: "navajo", title: "Masego - Navajo", channel: "Hash Music" },
  { id: "tadow", title: "FKJ & Masego - Tadow", channel: "Fkj" },
  { id: "ylang", title: "FKJ - Ylang Ylang", channel: "Fkj" },
  { id: "self-care", title: "Self Care", channel: "Mac Miller - Topic" },
  {
    id: "day-one",
    title: "Mac Miller - Day One (A Song About Nothing)",
    channel: "Majestic Casual",
  },
  {
    id: "beat",
    title: 'Mac Miller Type Beat - "Dysphoria" (SOLD)',
    channel: "Producer",
  },
  {
    id: "beat2",
    title: 'FREE Mac Miller/Joey Bada$$ Type Beat "Theory"',
    channel: "Producer",
  },
];
describe("music retrieval", () => {
  it("ranks the requested artist and title above another song by that artist", () => {
    const sorted = [...catalog].sort(
      (a, b) =>
        musicMatchRank("Mac Miller Self Care", b) -
        musicMatchRank("Mac Miller Self Care", a),
    );
    expect(sorted[0].id).toBe("self-care");
  });
  it("ranks actual artist recordings above type beats even without artist in title", () => {
    expect(musicMatchRank("Mac Miller", catalog[4])).toBeGreaterThan(
      musicMatchRank("Mac Miller", catalog[6]),
    );
    expect(musicMatchRank("Mac Miller", catalog[5])).toBeGreaterThan(
      musicMatchRank("Mac Miller", catalog[7]),
    );
  });
  it("keeps requested type beats and live versions eligible", () => {
    expect(musicMatchRank("Mac Miller type beat", catalog[6])).toBeGreaterThan(
      musicMatchRank("Mac Miller type beat", catalog[5]),
    );
    expect(musicMatchRank("Navajo COLORS SHOW", catalog[0])).toBeGreaterThan(
      musicMatchRank("Navajo COLORS SHOW", catalog[1]),
    );
  });
});
describe("explicit DJ requests", () => {
  it("plays only the requested songs, in order, preferring the original version", () => {
    expect(
      resolveExactRequest(
        "Joue Masego Navajo puis FKJ et Masego Tadow.",
        catalog,
      )?.tracks.map((t) => t.id),
    ).toEqual(["navajo", "tadow"]);
    expect(
      resolveExactRequest("Joue Tadow puis Navajo", catalog)?.tracks.map(
        (t) => t.id,
      ),
    ).toEqual(["tadow", "navajo"]);
  });
  it("does not force a three-song minimum for a single title", () => {
    expect(
      resolveExactRequest(
        "Mets-moi Mac Miller Self Care stp",
        catalog,
      )?.tracks.map((t) => t.id),
    ).toEqual(["self-care"]);
  });
  it("supports an explicitly ordered comma-separated list", () => {
    expect(
      resolveExactRequest(
        "Joue dans cet ordre : Navajo, Tadow, Ylang Ylang",
        catalog,
      )?.tracks.map((t) => t.id),
    ).toEqual(["navajo", "tadow", "ylang"]);
  });
  it("does not reinterpret an artist, mood or similarity request as one song", () => {
    for (const text of [
      "Du Mac Miller",
      "Joue du jazz doux",
      "Joue des titres comme Self Care",
      "Joue du Masego puis du jazz",
    ]) {
      const result = resolveExactRequest(text, catalog);
      expect(result === null || result.missing.length > 0).toBe(true);
    }
  });
  it("reports a missing requested title without substituting a suggestion", () => {
    const result = resolveExactRequest(
      "Joue Navajo puis ImaginarySong987",
      catalog,
    );
    expect(result?.missing).toEqual(["ImaginarySong987"]);
  });
  it("honors append and normalized accented names", () => {
    const result = resolveExactRequest("Ajoute Étoile triste", [
      { id: "etoile", title: "Étoile triste", channel: "Artiste" },
    ]);
    expect(result?.append).toBe(true);
    expect(result?.tracks[0].id).toBe("etoile");
  });
  it("asks for the artist when two distinct artists have the requested title", () => {
    const result = resolveExactRequest("Joue Hello", [
      { id: "adele", title: "Adele - Hello" },
      { id: "lionel", title: "Lionel Richie - Hello" },
    ]);
    expect(result?.tracks).toEqual([]);
    expect(result?.missing).toEqual(["Hello"]);
  });
});
