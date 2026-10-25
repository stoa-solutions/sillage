import { LEGACY_USER } from "../src/accounts.ts";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import { enqueue, claim, finish, schedule } from "../src/queue.ts";
import { infer } from "../src/inference-client.ts";
import { indexText, indexImage } from "../src/indexing.ts";
import {
  enqueueMissing,
  enrichVideos,
  importLibrary,
  syncPlaylist,
} from "../src/library.ts";
import { YouTube } from "../src/youtube.ts";
import type { LibraryImport } from "@playlist-recall/core/types";
vi.mock("../src/inference-client.ts", () => ({ infer: vi.fn() }));
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a disposable _test database.");
const db = new pg.Pool({ connectionString: url });
const app = createApp(db);
const token = "integration-test-token";
const fixture: LibraryImport = {
  playlists: [
    {
      id: "PL1234567890",
      title: "Music",
      sourceUrl: "https://www.youtube.com/playlist?list=PL1234567890",
      importedAt: new Date().toISOString(),
    },
  ],
  videos: [
    {
      id: "abcdefghijk",
      title: "Blue saxophone",
      channel: "Jazz",
      durationSeconds: 7200,
      description: "Romantic evening music",
      tags: [],
      publishedAt: null,
      thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
    },
  ],
  memberships: [
    {
      key: "old:1",
      playlistId: "PL1234567890",
      videoId: "abcdefghijk",
      position: 1,
    },
  ],
};
beforeAll(() => migrate(db));
beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await db.query(
    "TRUNCATE tokens,playlists,videos,channels,jobs,quota_usage,dj_usage,account_dj_usage,account_dj_settings CASCADE",
  );
  await db.query("INSERT INTO tokens(id,name,hash) VALUES($1,$2,$3)", [
    randomUUID(),
    "test",
    hash(token),
  ]);
});
afterAll(() => db.end());
it("requires authentication and applies numerical search filters through HTTP", async () => {
  expect((await app.request("/v1/status")).status).toBe(401);
  await importLibrary(db, fixture);
  const request = (minDuration: number) =>
    app.request("/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "", minDuration }),
    });
  expect((await (await request(3600)).json()).total).toBe(1);
  expect((await (await request(7200)).json()).total).toBe(0);
});
it("deduplicates active tasks and rejects completion from an expired lease", async () => {
  const first = await enqueue(db, "sync", "PL1234567890", {
    playlistId: "PL1234567890",
  });
  expect(
    (await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" }))
      .id,
  ).toBe(first.id);
  const job = await claim(db);
  expect(job).toBeTruthy();
  await db.query(
    `UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
    [job!.id],
  );
  const replacement = await claim(db);
  expect(replacement!.lease_id).not.toBe(job!.lease_id);
  await finish(db, job!);
  expect(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [job!.id])).rows[0]
      .status,
  ).toBe("running");
  await finish(db, replacement!);
  expect(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [job!.id])).rows[0]
      .status,
  ).toBe("done");
});
it("does not replace active memberships when remote pagination fails", async () => {
  await importLibrary(db, fixture);
  await db.query("DELETE FROM jobs");
  await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" });
  const job = await claim(db);
  const youtube = {
    playlist: async () => {
      throw new Error("YouTube HTTP 503");
    },
  } as unknown as YouTube;
  await expect(syncPlaylist(db, youtube, job!)).rejects.toThrow();
  expect(
    (await db.query("SELECT count(*)::int AS n FROM memberships WHERE active"))
      .rows[0].n,
  ).toBe(1);
  expect(
    (await db.query("SELECT generation FROM playlists")).rows[0].generation,
  ).toBe("0");
});
it("requires two successful snapshots before removing missing entries", async () => {
  await importLibrary(db, fixture);
  await db.query("DELETE FROM jobs");
  const youtube = {
    playlist: async () => ({ title: "Music", entries: [] }),
  } as unknown as YouTube;
  for (let i = 0; i < 2; i++) {
    await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" });
    const job = await claim(db);
    await syncPlaylist(db, youtube, job!);
    await finish(db, job!);
    expect(
      (await db.query("SELECT active FROM memberships")).rows[0].active,
    ).toBe(i === 0);
    await db.query("DELETE FROM jobs");
  }
});
it("does not let an old import overwrite enriched video metadata", async () => {
  await importLibrary(db, fixture);
  await db.query(`UPDATE videos SET description='Enriched',enriched_at=now()`);
  await importLibrary(db, fixture);
  expect(
    (await db.query("SELECT description FROM videos")).rows[0].description,
  ).toBe("Enriched");
});

it("ignores a stale text result and commits all current passages atomically", async () => {
  await importLibrary(db, fixture);
  const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  vi.mocked(infer).mockImplementationOnce(async () => {
    await db.query(
      "UPDATE videos SET content_hash='newer' WHERE id='abcdefghijk'",
    );
    return { texts: ["Old"], vectors: [vector] } as any;
  });
  await indexText(db, "abcdefghijk");
  expect(
    (await db.query("SELECT count(*)::int n FROM passages")).rows[0].n,
  ).toBe(0);
  vi.mocked(infer).mockResolvedValueOnce({
    texts: ["First", "Last"],
    vectors: [vector, vector],
  });
  await indexText(db, "abcdefghijk");
  expect(
    (await db.query("SELECT count(*)::int n FROM passages")).rows[0].n,
  ).toBe(2);
  expect(
    (await db.query("SELECT index_hash FROM videos")).rows[0].index_hash,
  ).toBe("newer");
  await db.query("UPDATE videos SET content_hash='changed'");
  vi.mocked(infer).mockResolvedValueOnce({
    texts: ["Valid", "Invalid"],
    vectors: [vector, [0]],
  });
  await expect(indexText(db, "abcdefghijk")).rejects.toThrow();
  expect(
    (await db.query("SELECT text FROM passages ORDER BY ordinal")).rows.map(
      (r) => r.text,
    ),
  ).toEqual(["First", "Last"]);
});
it("reindexes a changed thumbnail even when its URL stays the same", async () => {
  await importLibrary(db, fixture);
  process.env.VISION_ENABLED = "true";
  const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
  vi.mocked(infer).mockResolvedValue({ vector });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response("image-one", {
          headers: { "content-type": "image/jpeg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("image-two", {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
  );
  await indexImage(db, "abcdefghijk");
  const before = (await db.query("SELECT source_hash FROM images")).rows[0]
    .source_hash;
  await indexImage(db, "abcdefghijk");
  expect(
    (await db.query("SELECT source_hash FROM images")).rows[0].source_hash,
  ).not.toBe(before);
  expect(infer).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});
it("matches unaccented words against accented metadata", async () => {
  await importLibrary(db, fixture);
  await db.query("UPDATE videos SET title='Vidéo préférée'");
  const result = await db.query(
    "SELECT id FROM videos WHERE search_document @@ websearch_to_tsquery('recall_simple','video preferee')",
  );
  expect(result.rowCount).toBe(1);
});
it("requeues failed work once and permits successful recovery", async () => {
  const first = await enqueue(db, "sync", "PL1234567890", {
    playlistId: "PL1234567890",
  });
  const job = await claim(db);
  await finish(db, { ...job!, attempts: 5 }, new Error("temporary"));
  expect(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [first.id])).rows[0]
      .status,
  ).toBe("failed");
  const response = await app.request("/v1/jobs/retry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await response.json()).retried).toBe(1);
  const retry = await claim(db);
  await finish(db, retry!);
  expect(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [first.id])).rows[0]
      .status,
  ).toBe("done");
});

it("returns the channel photo with search results and reuses it for a month", async () => {
  await importLibrary(db, fixture);
  const request = vi.fn(async (input: unknown) =>
    String(input).includes("/channels")
      ? Response.json({
          items: [
            {
              id: "UCjazz",
              snippet: {
                thumbnails: { default: { url: "https://yt3.ggpht.com/jazz" } },
              },
            },
          ],
        })
      : Response.json({
          items: [
            {
              id: "abcdefghijk",
              snippet: {
                title: "Blue saxophone",
                channelTitle: "Jazz",
                channelId: "UCjazz",
              },
              contentDetails: { duration: "PT2H" },
            },
          ],
        }),
  );
  const youtube = new YouTube("secret", undefined, request);
  await enrichVideos(db, youtube, ["abcdefghijk"]);
  await enrichVideos(db, youtube, ["abcdefghijk"]);
  const channelCalls = request.mock.calls.filter(([url]) =>
    String(url).includes("/channels"),
  );
  expect(channelCalls).toHaveLength(1);
  vi.mocked(infer).mockRejectedValueOnce(new Error("Unavailable"));
  const response = await app.request("/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "" }),
  });
  const data = await response.json();
  expect(data.results[0].video.channelAvatarUrl).toBe(
    "https://yt3.ggpht.com/jazz",
  );
});

it("finds partial lexical matches in a natural-language query when inference is unavailable", async () => {
  await importLibrary(db, fixture);
  vi.mocked(infer).mockRejectedValueOnce(new Error("Unavailable"));
  const response = await app.request("/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "je cherche une vidéo blue pour ce soir" }),
  });
  const data = await response.json();
  expect(data.results[0].video.id).toBe("abcdefghijk");
  expect(data.degraded).toContain("mots-clés");
});

it("excludes queued videos and caps results inside the search", async () => {
  await importLibrary(db, fixture);
  vi.mocked(infer).mockRejectedValueOnce(new Error("Unavailable"));
  const response = await app.request("/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "blue",
      excludeIds: ["abcdefghijk"],
      availableOnly: true,
      limit: 1,
    }),
  });
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(
    data.results.map((r: { video: { id: string } }) => r.video.id),
  ).not.toContain("abcdefghijk");
  expect(data.results.length).toBeLessThanOrEqual(1);
});

it("hides historical failures after a newer successful attempt", async () => {
  await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" });
  const failed = await claim(db);
  await finish(db, { ...failed!, attempts: 5 }, new Error("old"));
  await db.query("UPDATE jobs SET created_at=now()-interval '1 minute'");
  await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" });
  const current = await claim(db);
  await finish(db, current!);
  const response = await app.request("/v1/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await response.json()).jobs).toEqual([]);
});

it("migrates moved duplicate entries by occurrence without duplicating the first live snapshot", async () => {
  await importLibrary(db, {
    ...fixture,
    memberships: [
      ...fixture.memberships,
      { ...fixture.memberships[0]!, key: "old:2", position: 5 },
    ],
  });
  await db.query("DELETE FROM jobs");
  await enqueue(db, "sync", "PL1234567890", { playlistId: "PL1234567890" });
  const job = await claim(db);
  const youtube = {
    playlist: async () => ({
      title: "Music",
      entries: [
        {
          key: "youtube-one",
          videoId: "abcdefghijk",
          position: 9,
          addedAt: null,
          title: "Blue saxophone",
          channel: "Jazz",
        },
        {
          key: "youtube-two",
          videoId: "abcdefghijk",
          position: 11,
          addedAt: null,
          title: "Blue saxophone",
          channel: "Jazz",
        },
      ],
    }),
  } as unknown as YouTube;
  await syncPlaylist(db, youtube, job!);
  expect(
    (
      await db.query(
        "SELECT key,position FROM memberships WHERE active ORDER BY position",
      )
    ).rows,
  ).toEqual([
    { key: "youtube-one", position: 9 },
    { key: "youtube-two", position: 11 },
  ]);
});
it("queues a due playlist once and advances its six-hour schedule", async () => {
  await importLibrary(db, fixture);
  await db.query("DELETE FROM jobs");
  process.env.SYNC_ENABLED = "true";
  try {
    await schedule(db);
    await schedule(db);
  } finally {
    process.env.SYNC_ENABLED = "false";
  }
  expect(
    (await db.query("SELECT count(*)::int n FROM jobs WHERE kind='sync'"))
      .rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "SELECT next_sync_at>now()+interval '5 hours' AS future FROM playlists",
      )
    ).rows[0].future,
  ).toBe(true);
});

it("keeps YouTube work pending without consuming retries when the key is absent", async () => {
  const sync = await enqueue(db, "sync", "waiting", {
    playlistId: "PL1234567890",
  });
  await enqueue(db, "image", "available", { videoId: "abcdefghijk" });
  const image = await claim(db, false);
  expect(image?.kind).toBe("image");
  await finish(db, image!);
  expect(await claim(db, false)).toBeUndefined();
  expect(
    (await db.query("SELECT status,attempts FROM jobs WHERE id=$1", [sync.id]))
      .rows[0],
  ).toEqual({ status: "pending", attempts: 0 });
  expect((await claim(db, true))?.kind).toBe("sync");
});
it("records unavailable thumbnails without failing and checks them again after a day", async () => {
  process.env.VISION_ENABLED = "true";
  await importLibrary(db, fixture);
  await db.query("DELETE FROM jobs");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  await expect(indexImage(db, "abcdefghijk")).resolves.toBeUndefined();
  expect(infer).not.toHaveBeenCalled();
  expect(
    (await db.query("SELECT image_error,image_checked_at FROM videos")).rows[0],
  ).toMatchObject({
    image_error: "Miniature indisponible sur YouTube.",
    image_checked_at: expect.any(Date),
  });
  await enqueueMissing(db);
  expect(
    (await db.query("SELECT count(*)::int n FROM jobs WHERE kind='image'"))
      .rows[0].n,
  ).toBe(0);
  await db.query(
    "UPDATE videos SET image_checked_at=now()-interval '25 hours'",
  );
  await enqueueMissing(db);
  expect(
    (await db.query("SELECT count(*)::int n FROM jobs WHERE kind='image'"))
      .rows[0].n,
  ).toBe(1);
});
it("still retries temporary thumbnail service failures", async () => {
  process.env.VISION_ENABLED = "true";
  await importLibrary(db, fixture);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(indexImage(db, "abcdefghijk")).rejects.toThrow(
    "Miniature HTTP 503",
  );
});

it("exposes authenticated MCP tools with a real protocol handshake", async () => {
  expect((await app.request("/v1/mcp", { method: "POST" })).status).toBe(401);
  const response = await app.request("/v1/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "integration", version: "1" },
      },
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).result.serverInfo.name).toBe(
    "recall-music-library",
  );
});
it("searches available music through an MCP client and respects exclusions", async () => {
  const { connectMusicMcp } = await import("../src/music-mcp.ts");
  await importLibrary(db, fixture);
  await db.query("UPDATE videos SET title='Jazz du soir',duration_seconds=180");
  const mcp = await connectMusicMcp(db);
  try {
    expect((await mcp.client.listTools()).tools.map((t) => t.name)).toEqual([
      "seekInformation",
      "library_search",
      "library_overview",
    ]);
    const result = await mcp.client.callTool({
      name: "library_search",
      arguments: { query: "jazz", maxDurationSeconds: 1200 },
    });
    expect(JSON.parse((result.content as any)[0].text).tracks[0].id).toBe(
      "abcdefghijk",
    );
  } finally {
    await mcp.close();
  }
  const excluded = await connectMusicMcp(db, ["abcdefghijk"]);
  try {
    const result = await excluded.client.callTool({
      name: "library_search",
      arguments: { query: "jazz", maxDurationSeconds: 1200 },
    });
    expect(JSON.parse((result.content as any)[0].text).tracks).toEqual([]);
    const requested = await excluded.client.callTool({
      name: "library_search",
      arguments: { query: "jazz", includeQueued: true },
    });
    expect(JSON.parse((requested.content as any)[0].text).tracks[0].id).toBe(
      "abcdefghijk",
    );
  } finally {
    await excluded.close();
  }
});
it("finds long music without an implicit duration cap", async () => {
  await importLibrary(db, fixture);
  const { connectMusicMcp } = await import("../src/music-mcp.ts");
  const mcp = await connectMusicMcp(db);
  try {
    const result = await mcp.client.callTool({
      name: "library_search",
      arguments: { query: "saxoph" },
    });
    expect(
      JSON.parse((result.content as any)[0].text).tracks.map((t: any) => t.id),
    ).toContain("abcdefghijk");
    const limited = await mcp.client.callTool({
      name: "library_search",
      arguments: { query: "Blue saxophone", maxDurationSeconds: 1200 },
    });
    expect(JSON.parse((limited.content as any)[0].text).tracks).toEqual([]);
  } finally {
    await mcp.close();
  }
});
it.skipIf(!process.env.DJ_SIMULATION_URL)(
  "runs the DJ over HTTP against a simulated model and rejects fabricated selections",
  async () => {
    await importLibrary(db, fixture);
    await db.query(
      "UPDATE videos SET title='Jazz du soir',duration_seconds=180",
    );
    const saved = {
      DJ_API_KEY: process.env.DJ_API_KEY,
      DJ_MODEL: process.env.DJ_MODEL,
      DJ_BASE_URL: process.env.DJ_BASE_URL,
    };
    Object.assign(process.env, {
      DJ_API_KEY: "simulation-only",
      DJ_MODEL: "fixture",
      DJ_BASE_URL: process.env.DJ_SIMULATION_URL,
    });
    try {
      const send = (message: string) =>
        app.request("/v1/dj/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        });
      const response = await send("Du jazz pour ce soir");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "replace",
        source: "mcp",
        tracks: [{ id: "abcdefghijk", title: "Jazz du soir" }],
      });
      const hallucination = await send("SIMULATE_HALLUCINATION");
      expect(hallucination.status).toBe(502);
      expect((await hallucination.json()).error).toContain("non vérifié");
      const unavailable = await send("SIMULATE_503");
      expect(unavailable.status).toBe(502);
      expect((await unavailable.json()).error).not.toContain("simulation-only");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);

it("stores a personal DJ key encrypted, scopes it to its account and never returns it", async () => {
  vi.stubEnv("DJ_SETTINGS_ENCRYPTION_KEY", "42".repeat(32));
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const secret = "fake-gemini-key-for-integration-test";
  const save = await app.request("/v1/dj/settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ apiKey: secret, model: "gemini-4-argon" }),
  });
  expect(save.status).toBe(200);
  const row = (await db.query("SELECT encrypted_key FROM account_dj_settings"))
    .rows[0];
  expect(row.encrypted_key).not.toContain(secret);
  const status = await app.request("/v1/dj/status", { headers });
  const body = await status.json();
  expect(body).toMatchObject({
    personal: true,
    configured: true,
    model: "gemini-4-argon",
  });
  expect(JSON.stringify(body)).not.toContain(secret);
  const { personalDjConfig } = await import("../src/dj-settings.ts");
  const owner = (
    await db.query("SELECT user_id AS id FROM tokens WHERE hash=$1", [
      hash(token),
    ])
  ).rows[0].id;
  expect((await personalDjConfig(db, owner)).key).toBe(secret);
  const otherId = randomUUID();
  await db.query("INSERT INTO tokens(id,name,hash) VALUES($1,$2,$3)", [
    otherId,
    "other",
    hash("other-installation-token"),
  ]);
  expect((await personalDjConfig(db, otherId)).personal).toBe(false);
  const update = await app.request("/v1/dj/settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "gemini-3.8-flash" }),
  });
  expect(update.status).toBe(200);
  expect(await personalDjConfig(db, owner)).toMatchObject({
    key: secret,
    model: "gemini-3.8-flash",
  });
  const reset = await app.request("/v1/dj/settings/reset", {
    method: "POST",
    headers,
    body: "{}",
  });
  expect(reset.status).toBe(200);
  expect((await personalDjConfig(db, owner)).personal).toBe(false);
});
it("refuses credential storage without a valid encryption key", async () => {
  vi.stubEnv("DJ_SETTINGS_ENCRYPTION_KEY", "");
  const response = await app.request("/v1/dj/settings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: "fake-gemini-key-for-integration-test",
      model: "gemini-4-argon",
    }),
  });
  expect(response.status).toBe(503);
  expect(
    (await db.query("SELECT count(*)::int n FROM account_dj_settings")).rows[0]
      .n,
  ).toBe(0);
});

it("resolves a complete metadata lookup without inference and rejects invented songs", async () => {
  await importLibrary(db, fixture);
  const request = (query: string) => app.request("/v1/search", {
    method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type":"application/json"}, body: JSON.stringify({query})
  });
  const direct = await (await request("Blue saxophone")).json();
  expect(direct.results[0].video.id).toBe("abcdefghijk");
  expect(infer).not.toHaveBeenCalled();
  vi.mocked(infer).mockResolvedValue({vector:Array(384).fill(0.01)});
  const missing = await (await request("Blue nonexistent987")).json();
  expect(missing.total).toBe(0);
  expect(missing.results).toEqual([]);
});
