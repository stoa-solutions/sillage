import { expect, it, vi } from "vitest";
import {
  searchFailureMessage,
  searchFailureSummary,
} from "../src/search-feedback.ts";
import { Discovery, discoveryRoutes } from "../src/discovery.ts";
import { SearxngError } from "../src/searxng.ts";
import { YouTubeError, youtubeError } from "../src/youtube-errors.ts";
import { readToolEvidence } from "../src/features/dj/evidence.ts";
import { noSelectionReply } from "../src/features/dj/reply.ts";
import type { Database } from "../src/db/index.ts";

const now = Date.parse("2026-10-25T20:00:00Z");
it("explains the server quota, planned reset and distinction from the personal Gemini key", () => {
  const message = searchFailureMessage(
    { source: "youtube", reason: "daily_quota" },
    now,
  );
  expect(message).toContain("26/10");
  expect(message).toContain("08:00");
  expect(message).toContain("heure de Paris");
  expect(message).toContain("clé Gemini");
  expect(message).not.toContain("instant");
});
it.each([
  "rate_or_quota",
  "unavailable",
  "not_configured",
  "access_denied",
  "local_budget",
] as const)(
  "gives a distinct actionable diagnosis for %s without inventing a reset",
  (reason) => {
    const message = searchFailureMessage({ source: "youtube", reason }, now);
    expect(message).not.toContain("Renouvellement prévu");
    expect(message.length).toBeGreaterThan(70);
  },
);
it("names both failed sources once and keeps the no-result case separate", () => {
  const failures = [
    { source: "youtube", reason: "daily_quota" },
    { source: "library", reason: "unavailable" },
  ] as const;
  const summary = searchFailureSummary([...failures, ...failures], now);
  expect(summary.match(/quota quotidien/g)).toHaveLength(1);
  expect(summary).toContain("tes playlists est momentanément indisponible");
  const reply = noSelectionReply(summary);
  expect(reply).toContain("Ta lecture et ta file sont conservées");
  expect(reply).not.toContain("Tes playlists restent disponibles");
  expect(noSelectionReply()).not.toMatch(/quota|indisponible/);
});
it("uses only whitelisted reasons from tool evidence and never renders a private provider message", () => {
  const evidence = readToolEvidence("music_search", {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          results: [],
          sources: [
            {
              source: "youtube",
              status: "error",
              reason: "private-key-value",
              message: "private body",
            },
          ],
        }),
      },
    ],
  });
  expect(evidence.failures).toEqual([
    { source: "youtube", reason: "unavailable" },
  ]);
  expect(searchFailureSummary(evidence.failures, now)).not.toContain("private");
});
it("exposes safe actionable error codes and a machine-readable reset in Discover", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const db = {} as Database;
    const source = {
      search: vi.fn().mockRejectedValue(new YouTubeError("daily_quota", 429)),
      videos: vi.fn(),
    };
    const routes = discoveryRoutes(db, new Discovery(db, source));
    const response = await routes.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "afro" }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      source: "youtube",
      reason: "daily_quota",
      retryAt: "2026-10-26T07:00:00.000Z",
      error: expect.stringContaining("08:00"),
    });
  } finally {
    vi.restoreAllMocks();
  }
});
it("distinguishes forbidden credentials from daily quota even when both use HTTP 403", () => {
  expect(youtubeError(403, {}).kind).toBe("access_denied");
  expect(youtubeError(401, {}).kind).toBe("access_denied");
  expect(
    youtubeError(403, { error: { errors: [{ reason: "quotaExceeded" }] } })
      .kind,
  ).toBe("daily_quota");
});

it.each([
  [new Error("Clé YouTube absente"), "not_configured", 503],
  [new YouTubeError("access_denied", 403), "access_denied", 503],
  [new YouTubeError("rate_limit", 429), "rate_or_quota", 429],
  [new Error("Budget YouTube épuisé"), "local_budget", 429],
  [new Error("private connection details"), "unavailable", 502],
] as const)(
  "maps adapter failures to safe HTTP feedback: %s",
  async (error, reason, status) => {
    const db = {} as Database;
    const routes = discoveryRoutes(
      db,
      new Discovery(db, {
        search: vi.fn().mockRejectedValue(error),
        videos: vi.fn(),
      }),
    );
    const response = await routes.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "afro" }),
    });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ source: "youtube", reason });
    expect(body).not.toHaveProperty("retryAt");
    expect(JSON.stringify(body)).not.toContain("private");
  },
);

it.each(["search_blocked", "search_unavailable"] as const)(
  "preserves %s through Discover and DJ evidence",
  async (reason) => {
    const routes = discoveryRoutes(
      {} as Database,
      new Discovery({} as Database, {
        search: vi.fn().mockRejectedValue(new SearxngError(reason)),
        videos: vi.fn(),
      }),
    );
    const response = await routes.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "afro" }),
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.reason).toBe(reason);
    expect(body.retryAt).toBeUndefined();
    const evidence = readToolEvidence("music_search", {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [],
            sources: [{ source: "youtube", status: "error", reason }],
          }),
        },
      ],
    });
    expect(evidence.failures).toEqual([{ source: "youtube", reason }]);
    expect(searchFailureSummary(evidence.failures, now)).toContain(
      "moteur de recherche YouTube",
    );
  },
);
