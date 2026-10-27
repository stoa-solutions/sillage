import { expect, it, vi } from "vitest";
import { discoveryHome, discoverySeeds } from "../src/features/discovery/index.ts";
import { required } from "./support/required.ts";
const played = {
  video_id: "played00001",
  title: "Known Song",
  channel: "Artist - Topic",
  outcome: "finished",
  music_metadata: null,
};
const history = [played];
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
      { ...played, channel: "Skipped", outcome: "skipped" },
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
  const loadHistory = vi.fn().mockResolvedValue(history);
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
    loadHistory,
    "alice",
    { search },
  );
  expect(loadHistory).toHaveBeenCalledWith("alice");
  expect(search).toHaveBeenCalledWith("alice", "Artist official music");
  expect(result.suggestions.map((r) => r.video.id)).toEqual(["newtrack001"]);
  expect(required(result.suggestions[0]).reason).toContain("Artist");
});
it("does not invent personal recommendations for an empty account, and does not cache deleted history", async () => {
  const loadHistory = vi.fn().mockResolvedValue([]);
  const search = vi.fn();
  const result = await discoveryHome(loadHistory, "bob", {
    search,
  });
  expect(result.suggestions).toEqual([]);
  expect(search).not.toHaveBeenCalled();
  expect(result.emptyReason).toContain("Écoute quelques morceaux");
});
it("keeps available suggestions when another seed fails", async () => {
  const loadHistory = vi.fn().mockResolvedValue([...history, { ...history[0], channel: "Second" }],
  );
  const search = vi
    .fn()
    .mockResolvedValueOnce({
      results: [{ video: video("newtrack001", "New"), inLibrary: false }],
    })
    .mockRejectedValueOnce(new Error("provider failure"));
  const result = await discoveryHome(
    loadHistory,
    "alice",
    { search },
  );
  expect(result.suggestions).toHaveLength(1);
  expect(result.notice).toContain("Une recherche");
});

it("distinguishes an artist credit from a homonymous song title", async () => {
  const loadHistory = vi.fn().mockResolvedValue([{ ...history[0], channel: "The Alchemist" }]);
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
    loadHistory,
    "alice",
    { search },
  );
  expect(result.suggestions.map((r) => r.video.id)).toEqual(["right000001"]);
});
