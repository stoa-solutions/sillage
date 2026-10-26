import { describe, expect, it } from "vitest";
import { parseImport, buildDocument } from "../src/import";
import { parseQuery, searchLibrary } from "../src/search";
import type { Video, Membership } from "../src/types";

const romantic: Video = {
  id: "swqpIE45v4c",
  title: "Sentimental Jazz - Smooth Venetian Night Jazz - Romantic Night Music",
  channel: "Relax Music",
  durationSeconds: 26796,
  description: "",
  tags: ["smooth jazz", "romantic jazz"],
  thumbnailUrl: "",
  url: "https://www.youtube.com/watch?v=swqpIE45v4c",
  publishedAt: null,
};
const game: Video = {
  ...romantic,
  id: "R6WvJOiX99s",
  title: "Code Your Own Kirby Game in a Browser",
  channel: "freeCodeCamp",
  durationSeconds: 7208,
  tags: [],
};
const short: Video = {
  ...romantic,
  id: "LI0TjdxEXPw",
  title: "Jazz Méditerranée",
  durationSeconds: 204,
  tags: [],
};
const unknown: Video = {
  ...romantic,
  id: "ALTlKgwjB3w",
  title: null,
  channel: null,
  durationSeconds: null,
  tags: [],
};
const membership = (id: string, position: number): Membership => ({
  key: `p:${position}`,
  playlistId: "p",
  videoId: id,
  position,
});
const videos = [romantic, game, short, unknown];
const memberships = videos.map((v, i) => membership(v.id, i + 1));

describe("playlist imports", () => {
  it("deduplicates videos while preserving repeated playlist entries and unknown metadata", () => {
    const result = parseImport({
      playlist: { id: "p", title: "My playlist" },
      videos: [
        { id: romantic.id, title: romantic.title, duration_seconds: 26796 },
        { id: romantic.id, title: romantic.title, duration_seconds: 26796 },
        { id: unknown.id, title: null, duration_seconds: null },
      ],
    });
    expect(result.videos).toHaveLength(2);
    expect(result.memberships).toHaveLength(3);
    expect(result.videos[1]!.durationSeconds).toBeNull();
    expect(result.videos[1]!.title).toBeNull();
  });
  it("accepts yt-dlp flat playlists and canonicalizes links from validated video IDs", () => {
    const result = parseImport({
      id: "PLtest",
      title: "Music",
      entries: [
        {
          id: romantic.id,
          title: "Jazz",
          duration: 70,
          url: "javascript:alert(1)",
          thumbnails: [{ url: "https://evil.test/tracker" }],
        },
      ],
    });
    expect(result.videos[0]!.durationSeconds).toBe(70);
    expect(result.videos[0]!.url).toBe(
      "https://www.youtube.com/watch?v=swqpIE45v4c",
    );
    expect(result.videos[0]!.thumbnailUrl).toBe(
      "https://i.ytimg.com/vi/swqpIE45v4c/hqdefault.jpg",
    );
  });
  it("rejects malformed files rather than silently replacing a library", () => {
    expect(() => parseImport({ videos: "oops" })).toThrow();
    expect(() =>
      parseImport({ playlist: { id: "p" }, videos: [{ id: "../../oops" }] }),
    ).toThrow();
    expect(() =>
      parseImport({
        playlist: { id: "p" },
        videos: [{ id: romantic.id, duration_seconds: -1 }],
      }),
    ).toThrow();
  });
  it("does not create a semantic document for an unidentified video", () => {
    expect(buildDocument(unknown)).toBe("");
    expect(buildDocument(romantic)).toContain("Romantic Night Music");
    expect(buildDocument(romantic)).not.toContain("26796");
  });
  it("preserves original positions from partial exports", () => {
    const normalized = parseImport({
      playlist: { id: "p" },
      videos: [{ id: romantic.id, position: 600 }],
    });
    const flat = parseImport({
      id: "p",
      entries: [{ id: romantic.id, playlist_index: 600 }],
    });
    expect(normalized.memberships[0]!.position).toBe(600);
    expect(flat.memberships[0]!.position).toBe(600);
  });
});

describe("search by memory", () => {
  it("extracts duration constraints while keeping the semantic part of the query", () => {
    expect(parseQuery("jazz romantique de plus d’une heure")).toEqual({
      text: "jazz romantique",
      minDuration: 3600,
    });
    expect(parseQuery("piano > 90 min")).toEqual({
      text: "piano",
      minDuration: 5400,
    });
    expect(parseQuery("coding moins de 10 minutes")).toEqual({
      text: "coding",
      maxDuration: 600,
    });
    expect(parseQuery("Plus d’une heure de jazz")).toEqual({
      text: "de jazz",
      minDuration: 3600,
    });
    expect(parseQuery("OVER 1 hour jazz")).toEqual({
      text: "jazz",
      minDuration: 3600,
    });
  });
  it("excludes missing and boundary durations when filtering strictly over an hour", () => {
    const exactly = { ...game, durationSeconds: 3600 };
    const results = searchLibrary(
      [romantic, exactly, short, unknown],
      memberships,
      "",
      { minDuration: 3600 },
    );
    expect(results.map((r) => r.video.id)).toEqual(["swqpIE45v4c"]);
  });
  it("finds the known jazz video and excludes short jazz even in a natural-language query", () => {
    const results = searchLibrary(
      videos,
      memberships,
      "jazz romantique de plus d’une heure",
      {},
    );
    expect(results.map((r) => r.video.id)).toEqual(["swqpIE45v4c"]);
  });
  it("retrieves an English title from a semantic French paraphrase without lexical overlap", () => {
    const vectors = new Map([
      [romantic.id, [1, 0]],
      [game.id, [0, 1]],
    ]);
    const results = searchLibrary(
      videos,
      memberships,
      "dîner en amoureux",
      { minDuration: 3600 },
      vectors,
      [1, 0],
    );
    expect(results[0]!.video.id).toBe("swqpIE45v4c");
    expect(results[0]!.semantic).toBe(true);
  });
  it("returns no unrelated keyword results and respects playlist membership", () => {
    expect(searchLibrary(videos, memberships, "xyzunlikely", {})).toEqual([]);
    expect(
      searchLibrary(videos, memberships, "jazz", {
        playlistId: "not-imported",
      }),
    ).toEqual([]);
  });
});
