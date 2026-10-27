import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import type { IdentityProvider } from "../src/features/auth/index.ts";
import { LEGACY_USER } from "../src/features/accounts/index.ts";
import { scheduleSync } from "../src/features/library/index.ts";
vi.mock("../src/inference-client.ts", () => ({
  infer: vi.fn().mockResolvedValue({ vector: Array(384).fill(0.01) }),
}));
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "history_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "alice-history-session-token-1234",
  tokenB = "bob-history-session-token-123456";
const provider: IdentityProvider = {
  authorize: () => "https://accounts.google.com/test",
  verify: async () => {
    throw new Error("unused");
  },
};
const app = createApp(db, provider);
const req = (method: string, path: string, token = tokenA, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const event = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  videoId: "alicevideo1",
  title: "Jazz Alice",
  channel: "Alice",
  outcome: "finished",
  playedAt: "2026-10-25T10:00:00.000Z",
  ...overrides,
});
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE users,tokens,playlists,videos,jobs CASCADE");
  await db.query(
    `INSERT INTO users(id,google_sub,email) VALUES($1,'google-alice','alice@example.test'),($2,'google-bob','bob@example.test')`,
    [alice, bob],
  );
  await db.query(
    `INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A',$2,$3),($4,'B',$5,$6)`,
    [randomUUID(), hash(tokenA), alice, randomUUID(), hash(tokenB), bob],
  );
  await db.query(
    `INSERT INTO playlists(id,title,source_url,sync_enabled) VALUES('PLalice12345','Alice','https://www.youtube.com/playlist?list=PLalice12345',true),('PLbob1234567','Bob','https://www.youtube.com/playlist?list=PLbob1234567',true),($1,'Mes découvertes','',false)`,
    [`recall-discoveries:${alice}`],
  );
  await db.query(
    `INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLalice12345'),($2,'PLbob1234567'),($1,$3)`,
    [alice, bob, `recall-discoveries:${alice}`],
  );
  await db.query(
    `INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES('alicevideo1','Jazz Alice','Alice','https://i.ytimg.com/vi/alicevideo1/hqdefault.jpg','hash-a'),('shared12345','Jazz commun','Shared','https://i.ytimg.com/vi/shared12345/hqdefault.jpg','hash-s')`,
  );
  await db.query(
    `INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('a','PLalice12345','alicevideo1',1,1),('sa','PLalice12345','shared12345',2,1),('sb','PLbob1234567','shared12345',1,1)`,
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("records listening history once per event, newest first, per account", async () => {
  const first = event({ playedAt: "2026-10-25T10:00:00.000Z" });
  const second = event({
    videoId: "notInLibrar",
    title: "Découverte YouTube",
    channel: null,
    outcome: "skipped",
    playedAt: "2026-10-25T10:04:00.000Z",
  });
  const sent = await req("POST", "/v1/history", tokenA, {
    events: [first, second],
  });
  expect(sent.status).toBe(200);
  expect(await sent.json()).toEqual({ recorded: 2 });
  // A retried upload after a lost response must not duplicate plays.
  const retried = await req("POST", "/v1/history", tokenA, {
    events: [first, second],
  });
  expect(await retried.json()).toEqual({ recorded: 0 });

  const history = await (await req("GET", "/v1/history")).json();
  expect(history.events.map((e: any) => [e.videoId, e.outcome])).toEqual([
    ["notInLibrar", "skipped"],
    ["alicevideo1", "finished"],
  ]);
  expect(history.events[0]).toMatchObject({
    id: second.id,
    title: "Découverte YouTube",
    channel: null,
    playedAt: "2026-10-25T10:04:00.000Z",
  });
  expect(
    (await (await req("GET", "/v1/history", tokenB)).json()).events,
  ).toEqual([]);
});

it("pages history with a limit and a before cursor", async () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    event({ playedAt: `2026-10-25T10:0${i}:00.000Z` }),
  );
  await req("POST", "/v1/history", tokenA, { events });
  const page = await (await req("GET", "/v1/history?limit=2")).json();
  expect(page.events.map((e: any) => e.playedAt)).toEqual([
    "2026-10-25T10:04:00.000Z",
    "2026-10-25T10:03:00.000Z",
  ]);
  const next = await (
    await req("GET", "/v1/history?limit=2&before=" + page.events[1].playedAt)
  ).json();
  expect(next.events.map((e: any) => e.playedAt)).toEqual([
    "2026-10-25T10:02:00.000Z",
    "2026-10-25T10:01:00.000Z",
  ]);
});

it("rejects malformed history and oversized batches", async () => {
  for (const body of [
    { events: [event({ outcome: "loved" })] },
    { events: [event({ videoId: "not a video id" })] },
    { events: [event({ playedAt: "hier" })] },
    { events: Array.from({ length: 101 }, () => event()) },
  ])
    expect((await req("POST", "/v1/history", tokenA, body)).status).toBe(400);
  expect((await req("GET", "/v1/history?limit=0")).status).toBe(400);
});

it("clears only the requesting account's history", async () => {
  await req("POST", "/v1/history", tokenA, { events: [event()] });
  await req("POST", "/v1/history", tokenB, { events: [event()] });
  expect((await req("DELETE", "/v1/history", tokenA)).status).toBe(200);
  expect((await (await req("GET", "/v1/history")).json()).events).toEqual([]);
  expect(
    (await (await req("GET", "/v1/history", tokenB)).json()).events,
  ).toHaveLength(1);
});

it("removes a playlist from one account without touching YouTube or other accounts", async () => {
  expect((await req("DELETE", "/v1/playlists/PLbob1234567")).status).toBe(404);
  expect((await req("DELETE", "/v1/playlists/PLalice12345")).status).toBe(200);
  const playlists = (await (await req("GET", "/v1/playlists")).json())
    .playlists;
  expect(playlists.map((p: any) => p.id)).toEqual([
    `recall-discoveries:${alice}`,
  ]);
  expect(
    (await (await req("POST", "/v1/search", tokenA, { query: "" })).json())
      .total,
  ).toBe(0);
  // Bob still has the shared video through his own playlist.
  expect(
    (await (await req("POST", "/v1/search", tokenB, { query: "" })).json())
      .total,
  ).toBe(1);
  await db.query(
    `INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('d',$1,'alicevideo1',1,0)`,
    [`recall-discoveries:${alice}`],
  );
  expect(
    (
      await req(
        "DELETE",
        "/v1/playlists/" + encodeURIComponent(`recall-discoveries:${alice}`),
      )
    ).status,
  ).toBe(200);
  expect((await (await req("GET", "/v1/playlists")).json()).playlists).toEqual(
    [],
  );
  const kept = await db.query(
    "SELECT count(*)::int AS n FROM memberships WHERE playlist_id=$1 AND active",
    [`recall-discoveries:${alice}`],
  );
  expect(kept.rows[0].n).toBe(0);
});

it("pages through plays recorded at the same moment without skipping any", async () => {
  const events = Array.from({ length: 5 }, () =>
    event({ playedAt: "2026-10-25T11:00:00.000Z" }),
  );
  await req("POST", "/v1/history", tokenA, { events });
  const seen: string[] = [];
  let query = "/v1/history?limit=2";
  for (let i = 0; i < 4; i++) {
    const page = (await (await req("GET", query)).json()).events;
    if (!page.length) break;
    seen.push(...page.map((e: any) => e.id));
    const last = page[page.length - 1];
    query = `/v1/history?limit=2&before=${last.playedAt}&beforeId=${last.id}`;
  }
  expect(new Set(seen)).toEqual(new Set(events.map((e) => e.id)));
  expect(seen).toHaveLength(5);
});

it("answers malformed JSON with a client error", async () => {
  const response = await app.request("/v1/history", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokenA,
      "Content-Type": "application/json",
    },
    body: "{not json",
  });
  expect(response.status).toBe(400);
});

it("moves the legacy account's history with its library when claimed", async () => {
  const legacyToken = "legacy-history-session-token-123";
  await db.query(
    "INSERT INTO users(id,google_sub,email) VALUES($1,NULL,NULL)",
    [LEGACY_USER],
  );
  await db.query(
    "INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'L',$2,$3)",
    [randomUUID(), hash(legacyToken), LEGACY_USER],
  );
  await req("POST", "/v1/history", legacyToken, { events: [event()] });
  expect(
    (await req("POST", "/v1/account/claim-library", tokenA, { legacyToken }))
      .status,
  ).toBe(200);
  expect((await (await req("GET", "/v1/history")).json()).events).toHaveLength(
    1,
  );
});

it("stops synchronising a playlist once no account holds it", async () => {
  process.env["SYNC_ENABLED"] = "true";
  try {
    await db.query(
      "UPDATE playlists SET sync_enabled=true,next_sync_at=now()-interval '1 minute' WHERE id LIKE 'PL%'",
    );
    await req("DELETE", "/v1/playlists/PLalice12345");
    await scheduleSync(db.orm);
    const jobs = await db.query(
      "SELECT payload->>'playlistId' AS id FROM jobs WHERE kind='sync' ORDER BY 1",
    );
    expect(jobs.rows.map((r) => r.id)).toEqual(["PLbob1234567"]);
  } finally {
    delete process.env["SYNC_ENABLED"];
  }
});
