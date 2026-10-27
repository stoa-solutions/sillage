import { describe, expect, it, vi } from "vitest";
import { YouTube } from "../src/youtube.ts";
import {
  nextYouTubeQuotaReset,
  youtubeError,
  YouTubeError,
} from "../src/youtube-errors.ts";
import { Discovery } from "../src/discovery.ts";
import type { Database } from "../src/db/index.ts";
import { required } from "./support/required.ts";

const daily = {
  error: {
    message: "private project and credential details",
    errors: [{ reason: "rateLimitExceeded" }],
    details: [
      {
        metadata: {
          quota_limit: "defaultSearchListPerDayPerProject",
          consumer: "private project",
        },
      },
    ],
  },
};

describe("YouTube quota diagnosis", () => {
  it("recognizes the actual daily search 429 without exposing provider details", () => {
    const error = youtubeError(429, daily);
    expect(error.kind).toBe("daily_quota");
    expect(JSON.stringify(error)).not.toContain("private");
    expect(error.message).not.toContain("private");
  });
  it.each(["quotaExceeded", "dailyLimitExceeded"])(
    "recognizes legacy daily quota reason %s",
    (reason) => {
      expect(youtubeError(403, { error: { errors: [{ reason }] } }).kind).toBe(
        "daily_quota",
      );
    },
  );
  it("does not suspend a transient rate limit for a whole day", () => {
    expect(
      youtubeError(429, {
        error: {
          errors: [{ reason: "rateLimitExceeded" }],
          details: [{ metadata: { quota_limit: "PerMinutePerUser" } }],
        },
      }).kind,
    ).toBe("rate_limit");
    expect(youtubeError(429, null).kind).toBe("rate_limit");
    expect(youtubeError(500, { error: { details: "invalid" } }).kind).toBe(
      "unavailable",
    );
  });
  it.each([
    ["2026-10-25T20:00:00Z", "2026-10-26T07:00:00Z"],
    ["2026-03-08T08:01:00Z", "2026-03-09T07:00:00Z"],
    ["2026-11-01T07:01:00Z", "2026-11-02T08:00:00Z"],
  ])("resumes at Pacific midnight, including DST: %s", (now, reset) => {
    expect(new Date(nextYouTubeQuotaReset(Date.parse(now))).toISOString()).toBe(
      new Date(reset).toISOString(),
    );
  });
  it("stops repeated exhausted searches but allows other endpoints and resumes the next day", async () => {
    let now = Date.parse("2026-10-25T20:00:00Z");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(daily, { status: 429 }))
      .mockImplementation(async () => Response.json({ items: [] }));
    const source = new YouTube("test-only", undefined, request, () => now);
    await expect(source.search("afro pop")).rejects.toMatchObject({
      kind: "daily_quota",
    });
    await expect(source.search("afro")).rejects.toMatchObject({
      kind: "daily_quota",
    });
    expect(request).toHaveBeenCalledOnce();
    await expect(source.videos(["video000001"])).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    now = nextYouTubeQuotaReset(now);
    await expect(source.search("afro")).resolves.toMatchObject({ videos: [] });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("allows transient retries", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    const source = new YouTube("test-only", undefined, request);
    await expect(source.search("afro")).rejects.toMatchObject({
      kind: "rate_limit",
    });
    await expect(source.search("afro")).resolves.toMatchObject({ videos: [] });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("preserves a daily diagnosis through discovery and keeps cached results account-scoped", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const video = { id: "video000001", title: "Afro", channel: "Artist" };
    const search = vi
      .fn()
      .mockResolvedValueOnce({ videos: [video], nextPageToken: null })
      .mockRejectedValue(new YouTubeError("daily_quota", 429));
    const service = new Discovery(db as unknown as Database, {
      search,
      videos: vi.fn(),
    });
    await service.search("alice", "afro");
    await expect(service.search("alice", "afro pop")).rejects.toMatchObject({
      status: 429,
      reason: "daily_quota",
    });
    const cached = await service.search("bob", "afro");
    expect(required(cached.results[0]).inLibrary).toBe(false);
    expect(db.query.mock.calls.at(-1)?.[1]).toEqual(["bob", [video.id]]);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
