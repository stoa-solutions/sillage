import { expect, it, vi } from "vitest";
import { InformationSearch, publicSourceUrl } from "../src/information.ts";

it("returns numbered public sources, removes markup, deduplicates and caches only the query", async () => {
  const fetcher = vi.fn(async (_input: string | URL | Request) =>
    Response.json({
      results: [
        {
          title: "<b>Interview</b>",
          url: "https://artist.test/interview",
          content: "Artist discusses the song.",
        },
        {
          title: "Duplicate",
          url: "https://artist.test/interview",
          content: "same",
        },
        { title: "Bad", url: "javascript:alert(1)", content: "instruction" },
      ],
    }),
  );
  const search = new InformationSearch("http://searxng:8080", fetcher);
  const first = await search.search("Jewel Usain Incapable inspiration");
  expect(first).toEqual({
    status: "ok",
    sources: [
      {
        id: 1,
        title: "Interview",
        url: "https://artist.test/interview",
        snippet: "Artist discusses the song.",
      },
    ],
  });
  expect(await search.search("jewel usain incapable inspiration")).toEqual(
    first,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.get("q")).toBe(
    "!go !ddg Jewel Usain Incapable inspiration",
  );
  expect(url.searchParams.has("categories")).toBe(false);
});
it.each([
  "http://localhost/path",
  "https://127.0.0.1/path",
  "https://user:password@artist.test",
  "file:///etc/passwd",
  "https://192.168.1.1",
  "https://music.local",
])("rejects inappropriate source links %s", (url) =>
  expect(publicSourceUrl(url)).toBeUndefined(),
);
it("distinguishes an outage from a true empty search and never leaks upstream errors", async () => {
  for (const body of [
    { results: [], unresponsive_engines: [["google", "CAPTCHA"]] },
    { wrong: "private-key" },
  ]) {
    const result = await new InformationSearch(
      "http://searxng",
      vi.fn(async () => Response.json(body)),
    ).search("Acid Coco");
    expect(result).toEqual({ status: "unavailable", sources: [] });
  }
  expect(
    await new InformationSearch(
      "http://searxng",
      vi.fn(async () => Response.json({ results: [] })),
    ).search("Unknown"),
  ).toEqual({ status: "ok", sources: [] });
});
