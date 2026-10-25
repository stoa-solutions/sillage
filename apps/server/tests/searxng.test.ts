import { expect, it, vi } from "vitest";
import { SearxngDiscovery, youtubeResultId } from "../src/searxng.ts";
import { YouTube } from "../src/youtube.ts";
import { YouTubeError } from "../src/youtube-errors.ts";

const ids = ["6R-R51CZ9tA", "ylpbHo6G6JU", "dixmrd_mN40"];
const row = (id: string) => ({ url: `https://www.youtube.com/watch?v=${id}` });
const metadata = (id: string, embeddable = true) => ({
  id,
  snippet: { title: `Verified ${id}`, channelTitle: "Acid Coco" },
  contentDetails: { duration: "PT3M20S" },
  status: { embeddable, privacyStatus: "public" },
});
const setup = (body: unknown) => {
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "searxng") return Response.json(body);
    if (url.pathname.endsWith("/videos"))
      return Response.json({
        items: [metadata(ids[2], false), metadata(ids[0])],
      });
    throw new Error("Official search must not be called");
  });
  return {
    request,
    source: new SearxngDiscovery(
      "http://searxng:8080",
      new YouTube("private-key", undefined, request),
      request,
    ),
  };
};

it("deduplicates discovery IDs, verifies one metadata batch and keeps provider order without invented paging", async () => {
  const { source, request } = setup({
    results: [
      row(ids[1]),
      row(ids[0]),
      row(ids[0]),
      row(ids[2]),
      { url: "https://evil.test/watch?v=" + ids[0] },
    ],
  });
  const result = await source.search("Acid Coco");
  expect(result.videos.map((v) => v.id)).toEqual([ids[0]]);
  expect(result.videos[0].title).toBe(`Verified ${ids[0]}`);
  expect(result.nextPageToken).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
  const query = new URL(String(request.mock.calls[0][0]));
  expect(query.searchParams.get("engines")).toBe("youtube");
  expect(query.searchParams.get("q")).toBe("!yt Acid Coco");
  expect(String(request.mock.calls[1][0])).not.toContain("private-key");
  await expect(source.search("Acid Coco", "PAGE2")).rejects.toMatchObject({
    reason: "search_unavailable",
  });
  expect(request).toHaveBeenCalledTimes(2);
});
it.each([
  "https://youtube.com.evil.test/watch?v=6R-R51CZ9tA",
  "https://www.youtube.com@evil.test/watch?v=6R-R51CZ9tA",
  "http://youtube.com/watch?v=6R-R51CZ9tA",
  "https://youtube.com:444/watch?v=6R-R51CZ9tA",
  "https://www.youtube.com/playlist?list=6R-R51CZ9tA",
  "https://youtu.be/../../file",
  "not a url",
])("rejects non-video destinations: %s", (url) =>
  expect(youtubeResultId(url)).toBeUndefined(),
);
it("accepts a direct short YouTube URL", () =>
  expect(youtubeResultId("https://youtu.be/6R-R51CZ9tA?t=1")).toBe(ids[0]));
it("returns a true empty result without a Google call", async () => {
  const { source, request } = setup({ results: [], unresponsive_engines: [] });
  expect((await source.search("no matches")).videos).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([
  [
    { results: [], unresponsive_engines: [["youtube", "CAPTCHA"]] },
    "search_blocked",
  ],
  [
    { results: [], unresponsive_engines: [["youtube", "timeout"]] },
    "search_unavailable",
  ],
  [
    {
      results: [row(ids[0])],
      unresponsive_engines: [["youtube", "too many requests"]],
    },
    "search_blocked",
  ],
  [{ unexpected: "private raw body" }, "search_unavailable"],
])(
  "distinguishes unavailable sources from no matches",
  async (body, reason) => {
    const { source } = setup(body);
    await expect(source.search("afro")).rejects.toMatchObject({ reason });
  },
);
it("bounds oversized provider responses", async () => {
  const request = vi.fn(async () => new Response(" ".repeat(1_048_577)));
  const youtube = { videos: vi.fn() };
  await expect(
    new SearxngDiscovery("http://searxng", youtube, request).search("afro"),
  ).rejects.toMatchObject({ reason: "search_unavailable" });
  expect(youtube.videos).not.toHaveBeenCalled();
});
it("keeps metadata quotas distinct from SearXNG failures", async () => {
  const request = vi.fn(async () => Response.json({ results: [row(ids[0])] }));
  const error = new YouTubeError("daily_quota", 403);
  const source = new SearxngDiscovery(
    "http://searxng",
    { videos: vi.fn().mockRejectedValue(error) },
    request,
  );
  await expect(source.search("Acid Coco")).rejects.toBe(error);
});
it.each([403, 429, 500])(
  "handles HTTP %s without leaking upstream data",
  async (status) => {
    const request = vi.fn(
      async () => new Response("private upstream", { status }),
    );
    const source = new SearxngDiscovery(
      "http://searxng",
      { videos: vi.fn() },
      request,
    );
    await expect(source.search("afro")).rejects.toMatchObject({
      reason: status === 500 ? "search_unavailable" : "search_blocked",
    });
  },
);
