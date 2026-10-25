import { expect, it, vi } from "vitest";
import { discoveryHome, discoverySeeds } from "../src/discovery-home.ts";
import type { Database } from "../src/db.ts";
const history = [
  {
    video_id: "played00001",
    title: "Known Song",
    channel: "Artist - Topic",
    outcome: "finished",
    music_metadata: null,
  },
];
const video = (id: string, title: string) => ({
  id,
  title,
  channel: "Artist",
  durationSeconds: 200,
  thumbnailUrl: "https://i.ytimg.com/test",
  url: `https://youtube.com/watch?v=${id}`,
});
it("uses recent positive history and ignores skips", () => {
  expect(
    discoverySeeds([
      ...history,
      { ...history[0], channel: "Skipped", outcome: "skipped" },
    ]),
  ).toEqual([
    {
      query: "Artist",
      reason: "Parce que tu as écouté Artist",
      kind: "artist",
    },
  ]);
});
it("queries only this account, excludes heard titles and owned tracks and labels its recommendation", async () => {
  const query = vi.fn().mockResolvedValue({ rows: history });
  const search = vi.fn().mockResolvedValue({
    results: [
      { video: video("played00001", "Known Song"), inLibrary: false },
      {
        video: video("alternate01", "Known Song (Official Video)"),
        inLibrary: false,
      },
      { video: video("owned000001", "Owned"), inLibrary: true },
      { video: video("newtrack001", "New song"), inLibrary: false },
    ],
  });
  const result = await discoveryHome(
    { query } as unknown as Database,
    "alice",
    { search },
  );
  expect(query.mock.calls[0][1]).toEqual(["alice"]);
  expect(search).toHaveBeenCalledWith("alice", "Artist official music");
  expect(result.suggestions.map((r) => r.video.id)).toEqual(["newtrack001"]);
  expect(result.suggestions[0].reason).toContain("Artist");
});
it("does not invent personal recommendations for an empty account, and does not cache deleted history", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const search = vi.fn();
  const result = await discoveryHome({ query } as unknown as Database, "bob", {
    search,
  });
  expect(result.suggestions).toEqual([]);
  expect(search).not.toHaveBeenCalled();
  expect(result.emptyReason).toContain("Écoute quelques morceaux");
});
it("keeps available suggestions when another seed fails", async () => {
  const query = vi.fn().mockResolvedValue({
    rows: [...history, { ...history[0], channel: "Second" }],
  });
  const search = vi
    .fn()
    .mockResolvedValueOnce({
      results: [{ video: video("newtrack001", "New"), inLibrary: false }],
    })
    .mockRejectedValueOnce(new Error("provider failure"));
  const result = await discoveryHome(
    { query } as unknown as Database,
    "alice",
    { search },
  );
  expect(result.suggestions).toHaveLength(1);
  expect(result.notice).toContain("Une recherche");
});

it("distinguishes an artist credit from a homonymous song title", async () => {
  const query = vi
    .fn()
    .mockResolvedValue({ rows: [{ ...history[0], channel: "The Alchemist" }] });
  const search = vi.fn().mockResolvedValue({
    results: [
      {
        video: {
          ...video(
            "wrong000001",
            'Blue Öyster Cult - "The Alchemist" - Official Music Video',
          ),
          channel: "Blue Öyster Cult",
        },
        inLibrary: false,
      },
      {
        video: {
          ...video(
            "right000001",
            "Freddie Gibbs & The Alchemist - A Thousand Mountains",
          ),
          channel: "Freddie Gibbs",
        },
        inLibrary: false,
      },
    ],
  });
  const result = await discoveryHome(
    { query } as unknown as Database,
    "alice",
    { search },
  );
  expect(result.suggestions.map((r) => r.video.id)).toEqual(["right000001"]);
});
