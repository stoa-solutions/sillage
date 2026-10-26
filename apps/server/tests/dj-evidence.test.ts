import { expect, it } from "vitest";
import { readToolEvidence } from "../src/features/dj/evidence.ts";

function candidate(index: number, inLibrary: boolean) {
  return {
    inLibrary,
    video: {
      id: `vid${String(index).padStart(8, "0")}`,
      title: `Track ${index} ` + "long title ".repeat(100),
      channel: "Long artist ".repeat(100),
      thumbnailUrl: "https://example.test/" + "image".repeat(1000),
      musicMetadata: {
        source: "MusicBrainz",
        status: "matched",
        searchText: "repeated search document ".repeat(10_000),
        artists: Array.from({ length: 12 }, () => ({
          name: "Credited musician ".repeat(100),
          role: "featured",
        })),
        albums: Array.from({ length: 20 }, () => ({
          title: "Long album name ".repeat(100),
        })),
        genres: Array.from({ length: 20 }, () => "ambient ".repeat(100)),
        artistGenres: Array.from({ length: 20 }, () =>
          "electronic ".repeat(100),
        ),
      },
    },
  };
}
function result(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
it("keeps mixed-source evidence valid and within budget even with very large enrichment", () => {
  const results = [
    ...Array.from({ length: 20 }, (_, index) => candidate(index, true)),
    ...Array.from({ length: 15 }, (_, index) => candidate(index + 20, false)),
  ];
  const evidence = readToolEvidence(
    "music_search",
    result({
      results,
      sources: [
        { source: "library", status: "ok" },
        { source: "youtube", status: "ok" },
      ],
    }),
  );
  expect(evidence.text.length).toBeLessThanOrEqual(20_000);
  const parsed = JSON.parse(evidence.text);
  expect(
    parsed.results.some((item: { inLibrary: boolean }) => item.inLibrary),
  ).toBe(true);
  expect(
    parsed.results.some((item: { inLibrary: boolean }) => !item.inLibrary),
  ).toBe(true);
  expect(parsed.results[1].video.id).toBe(results[20].video.id);
  expect(
    parsed.results.map((item: { video: { id: string } }) => item.video.id),
  ).toEqual(evidence.items.map((item) => item.video.id));
  expect(parsed.omittedCandidates).toBe(results.length - evidence.items.length);
  expect(parsed.omittedCandidates).toBeGreaterThan(0);
  expect(evidence.items[0].video).toEqual(results[0].video); // authoritative data remains intact
  expect(parsed.results[0].video.musicMetadata).toHaveProperty("artists");
  expect(parsed.results[0].video.musicMetadata).toHaveProperty("genres");
  expect(parsed.results[0].video.musicMetadata).not.toHaveProperty(
    "searchText",
  );
});
it("returns a valid bounded playlist list instead of slicing a JSON document", () => {
  const evidence = readToolEvidence(
    "library_browse",
    result({
      tracks: [],
      order: "oldest",
      playlists: Array.from({ length: 30 }, (_, index) => ({
        id: String(index),
        title: "Playlist ".repeat(10_000),
        tracks: 100,
      })),
    }),
  );
  expect(evidence.text.length).toBeLessThanOrEqual(20_000);
  expect(JSON.parse(evidence.text).playlists.length).toBeGreaterThan(0);
});
it("preserves source failures and unavailable image mode when there are no candidates", () => {
  const failure = readToolEvidence(
    "music_search",
    result({
      results: [],
      sources: [
        { source: "youtube", status: "error", reason: "rate_or_quota" },
      ],
    }),
  );
  expect(failure.failedSources).toBe(1);
  expect(JSON.parse(failure.text).sources[0].reason).toBe("rate_or_quota");
  expect(
    readToolEvidence(
      "music_search",
      result({
        results: [],
        sources: [{ source: "youtube", status: "unsupported" }],
      }),
    ).visualUnsupported,
  ).toBe(true);
});
