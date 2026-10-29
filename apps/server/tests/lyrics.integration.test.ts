import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/shared/content.ts";
import { createApp } from "../src/app.ts";
import { prefetchLyrics } from "../src/modules/lyrics/index.ts";
import {
  Lrclib,
  LyricsSourceBusy,
  type LyricsQuery,
  type LyricsRecord,
  type LyricsSource,
} from "../src/integrations/lrclib/index.ts";
vi.mock("../src/integrations/inference/client.ts", () => ({ infer: vi.fn() }));
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "lyrics_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
// Real LRCLIB answers, trimmed to their first lines.
const fixture = (name: string): LyricsRecord[] =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/lyrics/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const catalogue: Record<string, LyricsRecord[]> = {
  "self care": fixture("self-care"),
  "bad!": fixture("bad"),
  "ylang ylang": fixture("ylang-ylang"),
};
const queries: LyricsQuery[] = [];
let busy = false;
const source: LyricsSource = {
  async search(query) {
    queries.push(query);
    if (busy) throw new LyricsSourceBusy(30);
    const key = (query.track ?? query.q ?? "").toLowerCase();
    return (
      Object.entries(catalogue).find(([name]) => key.includes(name))?.[1] ?? []
    );
  },
};
const app = createApp(db, undefined, source);
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "alice-lyrics-token-1234567890",
  tokenB = "bob-lyrics-token-1234567890";
const req = (path: string, token = tokenA, body?: unknown) =>
  app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const lyrics = async (id: string, token = tokenA) => {
  const response = await req(`/v1/lyrics/${id}`, token);
  return { status: response.status, body: await response.json() };
};
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  queries.length = 0;
  busy = false;
  await db.query(
    "TRUNCATE users,tokens,playlists,videos,lyrics,lyrics_offsets CASCADE",
  );
  await db.query(
    `INSERT INTO users(id,google_sub,email) VALUES($1,'g-alice','alice@example.test'),($2,'g-bob','bob@example.test')`,
    [alice, bob],
  );
  await db.query(
    `INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A',$2,$3),($4,'B',$5,$6)`,
    [randomUUID(), hash(tokenA), alice, randomUUID(), hash(tokenB), bob],
  );
  await db.query(
    `INSERT INTO playlists(id,title,source_url) VALUES('PLalice12345','A','https://www.youtube.com/playlist?list=PLalice12345'),('PLbob1234567','B','https://www.youtube.com/playlist?list=PLbob1234567')`,
  );
  await db.query(
    `INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLalice12345'),($1,'PLbob1234567'),($2,'PLbob1234567')`,
    [alice, bob],
  );
  await db.query(
    `INSERT INTO videos(id,title,channel,duration_seconds,thumbnail_url,content_hash) VALUES
    ('SsKT0s5J8ko','Self Care','Mac Miller - Topic',346,'https://i.ytimg.com/vi/SsKT0s5J8ko/hqdefault.jpg','h1'),
    ('J6Pmz4vVWsM','Folie''s - BAD! (Clip Officiel)','Folie''s',169,'https://i.ytimg.com/vi/J6Pmz4vVWsM/hqdefault.jpg','h2'),
    ('ylangylang1','FKJ - Ylang Ylang','FKJ',213,'https://i.ytimg.com/vi/ylangylang1/hqdefault.jpg','h3'),
    ('sameroom123','same room','longleggss - Topic',128,'https://i.ytimg.com/vi/sameroom123/hqdefault.jpg','h4'),
    ('alicesolo12','Self Care','Mac Miller - Topic',346,'https://i.ytimg.com/vi/alicesolo12/hqdefault.jpg','h5')`,
  );
  await db.query(
    `INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES
    ('1','PLbob1234567','SsKT0s5J8ko',1,1),('2','PLbob1234567','J6Pmz4vVWsM',2,1),('3','PLbob1234567','ylangylang1',3,1),
    ('4','PLbob1234567','sameroom123',4,1),('5','PLalice12345','alicesolo12',1,1)`,
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("serves line-synced lyrics of a Topic video, matched on duration, and caches them", async () => {
  const first = await lyrics("SsKT0s5J8ko");
  expect(first.status).toBe(200);
  expect(first.body.status).toBe("synced");
  expect(first.body.durationDeltaMs).toBe(0);
  expect(first.body.lines[0]).toEqual({
    startMs: 6180,
    endMs: 12650,
    text: "Mhm, mhm",
  });
  expect(first.body.source.name).toBe("LRCLIB");
  expect(queries[0]).toEqual({ artist: "Mac Miller", track: "Self Care" });
  const calls = queries.length;
  expect((await lyrics("SsKT0s5J8ko", tokenB)).body.lines).toEqual(
    first.body.lines,
  );
  expect(queries.length).toBe(calls);
});

it("finds a clip from its YouTube title and reports the gap to the album version", async () => {
  const { body } = await lyrics("J6Pmz4vVWsM");
  expect(body.status).toBe("synced");
  expect(body.durationDeltaMs).toBe(8000);
  expect(queries[0]).toEqual({ artist: "Folie's", track: "BAD!" });
});

it("tells instrumental and missing songs apart without an error", async () => {
  expect((await lyrics("ylangylang1")).body).toMatchObject({
    status: "instrumental",
    lines: [],
  });
  expect((await lyrics("sameroom123")).body).toMatchObject({
    status: "missing",
    lines: [],
  });
});

it("retries missing lyrics after a week but keeps found ones for a month", async () => {
  await lyrics("sameroom123");
  await lyrics("SsKT0s5J8ko");
  await db.query("UPDATE lyrics SET fetched_at=now()-interval '8 days'");
  queries.length = 0;
  await lyrics("SsKT0s5J8ko");
  expect(queries).toEqual([]);
  await lyrics("sameroom123");
  expect(queries.length).toBeGreaterThan(0);
});

it("keeps playback going when the source is busy, without caching the failure", async () => {
  busy = true;
  expect((await lyrics("SsKT0s5J8ko")).body.status).toBe("unavailable");
  busy = false;
  expect((await lyrics("SsKT0s5J8ko")).body.status).toBe("synced");
});

it("keeps each account's timing correction to itself", async () => {
  const saved = await req("/v1/lyrics/J6Pmz4vVWsM/offset", tokenA, {
    offsetMs: 1500,
  });
  expect(saved.status).toBe(200);
  expect((await lyrics("J6Pmz4vVWsM")).body.offsetMs).toBe(1500);
  expect((await lyrics("J6Pmz4vVWsM", tokenB)).body.offsetMs).toBe(0);
  await req("/v1/lyrics/J6Pmz4vVWsM/offset", tokenA, { offsetMs: 0 });
  expect((await lyrics("J6Pmz4vVWsM")).body.offsetMs).toBe(0);
  expect(
    (await req("/v1/lyrics/J6Pmz4vVWsM/offset", tokenA, { offsetMs: 60000 }))
      .status,
  ).toBe(400);
});

it("serves the public lyrics of any known video, but keeps corrections to the library", async () => {
  // Lyrics are the song's, not the account's: Bob hears Alice's video, he sees its lyrics.
  const shared = await lyrics("alicesolo12", tokenB);
  expect(shared.status).toBe(200);
  expect(shared.body.status).toBe("synced");
  expect(
    (await req("/v1/lyrics/alicesolo12/offset", tokenB, { offsetMs: 500 }))
      .status,
  ).toBe(404);
  // A video the server never saw, without a way to name it, cannot be matched.
  expect((await lyrics("unknown0001")).status).toBe(404);
  expect((await req("/v1/lyrics/not-an-id")).status).toBe(400);
});

const music = { lyrics: vi.fn() };
const ovh = { lyrics: vi.fn() };
const describe = vi.fn();
const everySource = createApp(db, undefined, { lrclib: source, music, ovh, describe });
const lyricsFrom = async (id: string) => {
  const response = await everySource.request(`/v1/lyrics/${id}`, {
    headers: { Authorization: "Bearer " + tokenA },
  });
  return { status: response.status, body: await response.json() };
};

it("falls back on YouTube Music for this video, then lyrics.ovh, naming the source", async () => {
  music.lyrics.mockReset().mockImplementation(async (id: string) =>
    id === "sameroom123" ? { text: "same room, same light", provider: "Musixmatch" } : null,
  );
  ovh.lyrics.mockReset().mockResolvedValue("a discovery, word for word");
  describe.mockReset().mockImplementation(async (id: string) =>
    id === "discovery01" ? { title: "Pahua - Gritar", channel: "Pahua", durationSeconds: 180 } : null,
  );
  expect((await lyricsFrom("sameroom123")).body).toMatchObject({
    status: "plain",
    text: "same room, same light",
    source: { name: "YouTube Music · Musixmatch", id: null },
  });
  // A YouTube result outside any library: named by YouTube, then found on lyrics.ovh.
  const discovery = await lyricsFrom("discovery01");
  expect(discovery.body).toMatchObject({ status: "plain", source: { name: "lyrics.ovh" } });
  expect(ovh.lyrics).toHaveBeenCalledWith("Pahua", "Gritar");
  // Kept for everyone: the next play asks no source.
  ovh.lyrics.mockClear();
  await lyricsFrom("discovery01");
  expect(ovh.lyrics).not.toHaveBeenCalled();
  // Synchronised LRCLIB lyrics are never replaced by plain ones.
  expect((await lyricsFrom("SsKT0s5J8ko")).body.status).toBe("synced");
});

it("fetches the library's lyrics ahead, once", async () => {
  music.lyrics.mockReset().mockResolvedValue(null);
  ovh.lyrics.mockReset().mockResolvedValue(null);
  await prefetchLyrics(db, { lrclib: source, music, ovh });
  const { rows } = await db.query("SELECT video_id FROM lyrics");
  expect(rows.map((row: { video_id: string }) => row.video_id).sort()).toEqual([
    "J6Pmz4vVWsM",
    "SsKT0s5J8ko",
    "alicesolo12",
    "sameroom123",
    "ylangylang1",
  ]);
  queries.length = 0;
  await prefetchLyrics(db, { lrclib: source, music, ovh });
  expect(queries).toEqual([]);
});

it("identifies itself to LRCLIB and honours Retry-After before calling again", async () => {
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(
      /^Sillage\//,
    );
    return new Response("{}", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  });
  const client = new Lrclib(request as unknown as typeof fetch, undefined, 0);
  await expect(client.search({ q: "Self Care" })).rejects.toBeInstanceOf(
    LyricsSourceBusy,
  );
  await expect(client.search({ q: "Self Care" })).rejects.toBeInstanceOf(
    LyricsSourceBusy,
  );
  expect(request).toHaveBeenCalledTimes(1);
});
