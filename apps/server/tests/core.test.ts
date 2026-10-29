import { describe, it, expect, vi } from "vitest";
import {
  documentText,
  parsePlaylistId,
  isoDuration,
  vectorSql,
} from "../src/shared/content.ts";
import { YouTube } from "../src/integrations/youtube/index.ts";
import { fetchThumbnail } from "../src/integrations/youtube/index.ts";
import { required } from "./support/required.ts";
describe("YouTube input and complete snapshots", () => {
  it("accepts a playlist link but rejects arbitrary fetch targets", () => {
    expect(
      parsePlaylistId("https://www.youtube.com/playlist?list=PL1234567890"),
    ).toBe("PL1234567890");
    expect(() =>
      parsePlaylistId("https://example.com/playlist?list=PL1234567890"),
    ).toThrow();
    expect(() =>
      parsePlaylistId("http://127.0.0.1/?list=PL1234567890"),
    ).toThrow();
  });
  it("keeps duplicate videos as distinct playlist items across every page", async () => {
    const responses = [
      { items: [{ snippet: { title: "Saved" } }] },
      {
        items: [
          {
            id: "item1",
            snippet: { position: 0, title: "First" },
            contentDetails: { videoId: "abcdefghijk" },
          },
        ],
        nextPageToken: "next",
      },
      {
        items: [
          {
            id: "item2",
            snippet: { position: 1, title: "First" },
            contentDetails: { videoId: "abcdefghijk" },
          },
        ],
      },
    ];
    const request = vi.fn(
      async () => new Response(JSON.stringify(responses.shift())),
    ) as unknown as typeof fetch;
    const data = await new YouTube("test-key", undefined, request).playlist(
      "PL1234567890",
    );
    expect(data.entries.map((e) => e.position)).toEqual([1, 2]);
    expect(data.entries[0]!.videoId).toBe(data.entries[1]!.videoId);
    expect(String(vi.mocked(request).mock.calls[0]![0])).not.toContain(
      "test-key",
    );
  });
  it("rejects partial or repeating pagination", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ snippet: { title: "x" } }] })),
      )
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ items: [], nextPageToken: "same" })),
      );
    await expect(
      new YouTube("key", undefined, request).playlist("PL1234567890"),
    ).rejects.toThrow("Pagination");
  });
  it("reports a safe quota error without exposing the key", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }),
          { status: 403 },
        ),
    );
    await expect(
      new YouTube("secret", undefined, request).videos(["abcdefghijk"]),
    ).rejects.toMatchObject({ kind: "daily_quota", status: 403 });
  });
  it("reads channel ids and keeps only https channel photos", async () => {
    const request = vi.fn(async (input: unknown) =>
      String(input).includes("/channels")
        ? Response.json({
            items: [
              {
                id: "UCa",
                snippet: {
                  thumbnails: { default: { url: "https://yt3.ggpht.com/a" } },
                },
              },
              {
                id: "UCb",
                snippet: {
                  thumbnails: { default: { url: "http://insecure/b" } },
                },
              },
              { id: "UCc", snippet: {} },
            ],
          })
        : Response.json({
            items: [
              {
                id: "abcdefghijk",
                snippet: {
                  title: "Song",
                  channelTitle: "Artist",
                  channelId: "UCa",
                },
                contentDetails: { duration: "PT3M" },
              },
            ],
          }),
    );
    const youtube = new YouTube("secret", undefined, request);
    const [video] = await youtube.videos(["abcdefghijk"]);
    expect(required(video).channelId).toBe("UCa");
    const avatars = await youtube.channelAvatars(["UCa", "UCb", "UCc"]);
    expect([...avatars]).toEqual([["UCa", "https://yt3.ggpht.com/a"]]);
  });
  it("parses real duration fields and preserves unknown values", () => {
    expect(isoDuration("PT7H26M36S")).toBe(26796);
    expect(isoDuration()).toBe(null);
    expect(isoDuration("P1DT1H")).toBe(90000);
  });
});
describe("index inputs", () => {
  it("retains useful description content beyond the old 1000-character cutoff", () => {
    const text = documentText({
      title: "Music",
      channel: "Artist",
      tags: [],
      description:
        "a".repeat(1500) +
        "\nBlue saxophone\nSubscribe now\nhttps://example.com",
    });
    expect(text).toContain("Blue saxophone");
    expect(text).not.toContain("Subscribe");
    expect(text).not.toContain("https:");
  });
  it("rejects malformed or empty vectors", () => {
    expect(() => vectorSql([0, 0], 2)).toThrow();
    expect(() => vectorSql([1, NaN], 2)).toThrow();
    expect(() => vectorSql([1], 2)).toThrow();
  });
  it("does not fetch arbitrary hosts or follow redirects for thumbnails", async () => {
    const request = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response("pixels", { headers: { "content-type": "image/jpeg" } }),
    );
    await expect(
      fetchThumbnail("https://127.0.0.1/a", request),
    ).rejects.toThrow("interdit");
    expect(request).not.toHaveBeenCalled();
    await fetchThumbnail(
      "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
      request,
    );
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
});
