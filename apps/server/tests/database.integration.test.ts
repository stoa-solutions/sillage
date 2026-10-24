import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import { enqueue, claim, finish, schedule } from "../src/queue.ts";
import { infer } from "../src/inference-client.ts";
import { indexText, indexImage } from "../src/indexing.ts";
import { enqueueMissing, importLibrary, syncPlaylist } from "../src/library.ts";
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
  await db.query("TRUNCATE tokens,playlists,videos,jobs,quota_usage CASCADE");
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
  const sync = await enqueue(db, "sync", "waiting", { playlistId: "PL1234567890" });
  await enqueue(db, "image", "available", { videoId: "abcdefghijk" });
  const image = await claim(db, false);
  expect(image?.kind).toBe("image");
  await finish(db, image!);
  expect(await claim(db, false)).toBeUndefined();
  expect((await db.query("SELECT status,attempts FROM jobs WHERE id=$1", [sync.id])).rows[0])
    .toEqual({ status: "pending", attempts: 0 });
  expect((await claim(db, true))?.kind).toBe("sync");
});
it("records unavailable thumbnails without failing and checks them again after a day", async () => {
  process.env.VISION_ENABLED = "true";
  await importLibrary(db, fixture);
  await db.query("DELETE FROM jobs");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  await expect(indexImage(db, "abcdefghijk")).resolves.toBeUndefined();
  expect(infer).not.toHaveBeenCalled();
  expect((await db.query("SELECT image_error,image_checked_at FROM videos")).rows[0])
    .toMatchObject({ image_error: "Miniature indisponible sur YouTube.", image_checked_at: expect.any(Date) });
  await enqueueMissing(db);
  expect((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='image'")).rows[0].n).toBe(0);
  await db.query("UPDATE videos SET image_checked_at=now()-interval '25 hours'");
  await enqueueMissing(db);
  expect((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='image'")).rows[0].n).toBe(1);
});
it("still retries temporary thumbnail service failures", async () => {
  process.env.VISION_ENABLED = "true";
  await importLibrary(db, fixture);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await expect(indexImage(db, "abcdefghijk")).rejects.toThrow("Miniature HTTP 503");
});
