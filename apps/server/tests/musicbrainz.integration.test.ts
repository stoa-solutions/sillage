import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";
import { upsertVideo, videoFromRow } from "../src/library.ts";
import { documentText } from "../src/content.ts";
import {
  scheduleMusicEnrichment,
  enrichMusic,
  pilotIds,
} from "../src/musicbrainz/enrichment.ts";
import { MusicBrainzClient } from "../src/musicbrainz/client.ts";
import { claim, finish } from "../src/queue.ts";
import { musicTracks } from "../src/music-mcp.ts";
import { search } from "../src/search.ts";
import { indexText } from "../src/indexing.ts";
import { infer } from "../src/inference-client.ts";
vi.mock("../src/inference-client.ts", () => ({
  infer: vi.fn(async () => ({
    texts: ["credits"],
    vectors: [Array(384).fill(0.01)],
    vector: Array(384).fill(0.01),
  })),
}));
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: "-c search_path=musicbrainz_test,public",
});
const alice = randomUUID(),
  bob = randomUUID();
const video = {
  id: "C7vVkdPEun8",
  title: "Incapable (feat. HEDGES)",
  channel: "Jewel Usain - Topic",
  durationSeconds: 214,
  description: "Original YouTube",
  tags: [],
  publishedAt: null,
  thumbnailUrl: "https://i.ytimg.com/vi/C7vVkdPEun8/hqdefault.jpg",
  url: "https://youtube.com/watch?v=C7vVkdPEun8",
};
const recording = {
  id: "a30b0cec-cb5b-41ce-b0c6-c046a4271fa3",
  title: "Incapable",
  length: 213000,
  "artist-credit": [
    { artist: { id: "jewel", name: "Jewel Usain" }, joinphrase: " feat. " },
    { artist: { id: "beesau", name: "Béesau" }, joinphrase: " & " },
    { artist: { id: "hedges", name: "Hedges" } },
  ],
  releases: [
    {
      id: "release",
      title: "Où les garçons grandissent",
      status: "Official",
      "release-group": { id: "album", "primary-type": "Album" },
    },
  ],
};
const get = vi.fn(async (path: string) =>
  path === "recording/"
    ? { recordings: [recording] }
    : path.startsWith("artist/")
      ? { genres: [{ name: "hip hop" }] }
      : recording,
);
const provider = { get } as unknown as MusicBrainzClient;
beforeAll(async () => {
  await admin.query("CREATE SCHEMA musicbrainz_test");
  await migrate(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("MUSICBRAINZ_PILOT_IDS", video.id);
  await db.query(
    "TRUNCATE users,playlists,videos,jobs,musicbrainz_cache CASCADE",
  );
  await db.query("INSERT INTO users(id) VALUES($1),($2)", [alice, bob]);
  await db.query(
    "INSERT INTO playlists(id,title,source_url) VALUES('pilot','Pilot','https://youtube.com')",
  );
  await db.query(
    "INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'pilot')",
    [alice],
  );
  await upsertVideo(db, video, true);
  await db.query(
    "INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('pilot:1','pilot',$1,0,1)",
    [video.id],
  );
});
afterAll(async () => {
  await db.end();
  await admin.query("DROP SCHEMA musicbrainz_test CASCADE");
  await admin.end();
  vi.unstubAllEnvs();
});
const row = async () =>
  (await db.query("SELECT * FROM videos WHERE id=$1", [video.id])).rows[0];
async function run() {
  await scheduleMusicEnrichment(db);
  const job = (await claim(db))!;
  await enrichMusic(db, job, provider);
  await finish(db, job);
  return job;
}
it("is opt-in, caps the pilot at ten, deduplicates and preserves YouTube", async () => {
  vi.stubEnv("MUSICBRAINZ_PILOT_IDS", "");
  await scheduleMusicEnrichment(db);
  expect((await db.query("SELECT * FROM jobs")).rowCount).toBe(0);
  vi.stubEnv(
    "MUSICBRAINZ_PILOT_IDS",
    Array.from({ length: 15 }, (_, i) => String(i).padStart(11, "0")).join(","),
  );
  expect(pilotIds()).toHaveLength(10);
  vi.stubEnv("MUSICBRAINZ_PILOT_IDS", video.id);
  await scheduleMusicEnrichment(db);
  await scheduleMusicEnrichment(db);
  expect((await db.query("SELECT * FROM jobs")).rowCount).toBe(1);
  await run();
  const r = await row();
  expect(r.title).toBe(video.title);
  expect(r.description).toBe(video.description);
  expect(r.music_metadata.status).toBe("matched");
  await scheduleMusicEnrichment(db);
  expect(
    (await db.query("SELECT * FROM jobs WHERE kind='musicbrainz'")).rowCount,
  ).toBe(1);
});
it("indexes credits and albums and isolates search and MCP by account", async () => {
  await run();
  const r = await row();
  expect(documentText(videoFromRow(r))).toContain("Béesau");
  for (const query of [
    "Béesau",
    "Où les garçons grandissent",
    "Jewel Hedges",
  ]) {
    const input = {
      query,
      mode: "text" as const,
      sort: "relevance" as const,
      offset: 0,
      limit: 20,
    };
    expect(
      (await search(db, input, alice)).results.map((v) => v.video.id),
    ).toEqual([video.id]);
    expect((await search(db, input, bob)).results).toEqual([]);
  }
  expect(
    (await musicTracks(db, [video.id], alice))[0].musicMetadata?.artists,
  ).toHaveLength(3);
  expect(await musicTracks(db, [video.id], bob)).toEqual([]);
  await indexText(db, video.id);
  expect((await row()).index_hash).toBe(r.content_hash);
  expect(
    vi
      .mocked(infer)
      .mock.calls.some((c) => JSON.stringify(c).includes("Béesau")),
  ).toBe(true);
});
it("retains enrichment across unchanged sync and invalidates changed identity", async () => {
  await run();
  const enriched = await row();
  await upsertVideo(db, video, true);
  expect((await row()).content_hash).toBe(enriched.content_hash);
  expect((await row()).music_metadata).toEqual(enriched.music_metadata);
  await upsertVideo(db, { ...video, title: "Different recording" }, true);
  expect((await row()).music_metadata).toBeNull();
  expect((await row()).content_hash).not.toBe(enriched.content_hash);
});
it("rejects a superseded job lease", async () => {
  await scheduleMusicEnrichment(db);
  const job = (await claim(db))!;
  await db.query("UPDATE jobs SET lease_id=$1 WHERE id=$2", [
    randomUUID(),
    job.id,
  ]);
  await enrichMusic(db, job, provider);
  expect((await row()).music_metadata).toBeNull();
});
it("retries temporary failures without publishing false missing metadata", async () => {
  await scheduleMusicEnrichment(db);
  const job = (await claim(db))!;
  const failed = {
    get: async () => {
      throw new Error("MusicBrainz unavailable");
    },
  } as unknown as MusicBrainzClient;
  await expect(enrichMusic(db, job, failed)).rejects.toThrow("unavailable");
  await finish(db, job, new Error("temporary"));
  expect((await row()).music_metadata).toBeNull();
  expect(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [job.id])).rows[0]
      .status,
  ).toBe("pending");
});
it("shares cached responses and limits concurrent uncached requests", async () => {
  const times: number[] = [];
  const fetcher = vi.fn(async () => {
    times.push(Date.now());
    return Response.json({ recordings: [] });
  }) as unknown as typeof fetch;
  const a = new MusicBrainzClient(db, fetcher),
    b = new MusicBrainzClient(db, fetcher);
  await Promise.all([
    a.get("recording/", { query: "one" }),
    b.get("recording/", { query: "two" }),
  ]);
  await b.get("recording/", { query: "one" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
});

it("rejects a result when the YouTube identity changes during lookup", async () => {
  await scheduleMusicEnrichment(db);
  const job = (await claim(db))!;
  const changing = {
    get: async (path: string) => {
      const value = await get(path);
      if (path === "recording/")
        await upsertVideo(db, { ...video, title: "Other song" }, true);
      return value;
    },
  } as unknown as MusicBrainzClient;
  await enrichMusic(db, job, changing);
  expect((await row()).music_metadata).toBeNull();
});

it("treats a known album as literal even when its name looks conversational", async () => {
  await run();
  await upsertVideo(
    db,
    {
      ...video,
      id: "other123456",
      title: "Unrelated song",
      description: "Les garçons dans une autre histoire",
    },
    true,
  );
  await upsertVideo(
    db,
    {
      ...video,
      id: "album123456",
      title: "Poussière",
      description: "Poussière · Jewel Usain\nOù les garçons grandissent",
    },
    true,
  );
  for (const id of ["other123456", "album123456"])
    await db.query(
      "INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES($1,'pilot',$1,1,1)",
      [id],
    );
  vi.mocked(infer).mockClear();
  const page = await search(
    db,
    {
      query: "Où les garçons grandissent",
      mode: "text",
      sort: "relevance",
      offset: 0,
      limit: 20,
    },
    alice,
  );
  expect(page.results.map((r) => r.video.id).sort()).toEqual(
    [video.id, "album123456"].sort(),
  );
  expect(infer).not.toHaveBeenCalled();
});
