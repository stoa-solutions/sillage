import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/shared/content.ts";
import { createApp } from "../src/app.ts";
import { tasteService } from "../src/modules/taste/index.ts";
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "taste_test",
  admin = new pg.Pool({ connectionString: url }),
  db = openDatabase({ url, schema });
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "taste-alice-token-12345678901",
  tokenB = "taste-bob-token-1234567890123";
const app = createApp(db);
const req = (method: string, path: string, token = tokenA, body?: unknown) =>
  app.request("/v1" + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const play = (videoId: string, outcome: string, listenedMs?: number) => ({
  id: randomUUID(),
  videoId,
  title: "Titre " + videoId,
  outcome,
  playedAt: "2026-10-28T10:00:00.000Z",
  ...(listenedMs === undefined ? {} : { listenedMs }),
});
const candidate = (id: string) => ({ video: { id, title: id }, inLibrary: true });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE users CASCADE");
  await db.query(
    "INSERT INTO users(id,google_sub,email) VALUES($1,'a','alice@example.test'),($2,'b','bob@example.test')",
    [alice, bob],
  );
  await db.query(
    "INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A',$2,$3),($4,'B',$5,$6)",
    [randomUUID(), hash(tokenA), alice, randomUUID(), hash(tokenB), bob],
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("gives, replaces and withdraws an opinion, for the current account only", async () => {
  expect(await (await req("GET", "/taste/feedback/track000001")).json()).toEqual({
    videoId: "track000001",
    value: null,
  });
  expect((await req("PUT", "/taste/feedback/track000001", tokenA, { value: "like" })).status).toBe(200);
  await req("PUT", "/taste/feedback/track000001", tokenA, { value: "dislike" });
  expect((await (await req("GET", "/taste/feedback/track000001")).json()).value).toBe("dislike");
  expect((await (await req("GET", "/taste/feedback/track000001", tokenB)).json()).value).toBeNull();
  await req("PUT", "/taste/feedback/track000001", tokenA, { value: "none" });
  expect((await (await req("GET", "/taste/feedback/track000001")).json()).value).toBeNull();
  expect((await req("PUT", "/taste/feedback/not-an-id", tokenA, { value: "like" })).status).toBe(400);
});

it("uses 5 days by default and keeps each account's own delay within bounds", async () => {
  expect(await (await req("GET", "/taste/settings")).json()).toEqual({ dislikeDays: 5 });
  expect(await (await req("PUT", "/taste/settings", tokenA, { dislikeDays: 12 })).json()).toEqual({
    dislikeDays: 12,
  });
  expect((await (await req("GET", "/taste/settings", tokenB)).json()).dislikeDays).toBe(5);
  expect((await req("PUT", "/taste/settings", tokenA, { dislikeDays: 0 })).status).toBe(400);
  expect((await req("PUT", "/taste/settings", tokenA, { dislikeDays: 61 })).status).toBe(400);
});

it("ranks an open search from real listens and opinions, never another account's", async () => {
  // Bob loves "skipped0001": that must not change Alice's ranking.
  await req("PUT", "/taste/feedback/skipped0001", tokenB, { value: "like" });
  const events = [
    ...Array.from({ length: 4 }, () => play("favorite001", "finished")),
    play("skipped0001", "skipped", 4_000),
    play("skipped0001", "skipped", 6_000),
    play("lateskip001", "skipped", 120_000),
    // An old skip without a listening time says nothing either way.
    play("oldskip0001", "skipped"),
    play("oldskip0001", "skipped"),
  ];
  expect((await req("POST", "/history", tokenA, { events })).status).toBe(200);
  await req("PUT", "/taste/feedback/disliked001", tokenA, { value: "dislike" });
  await req("PUT", "/taste/feedback/liked000001", tokenA, { value: "like" });

  const ids = ["unknown0001", "skipped0001", "oldskip0001", "disliked001", "lateskip001", "favorite001", "liked000001"];
  const ranked = await tasteService(db).rank(alice, ids.map(candidate));
  expect(ranked.map((item) => item.video.id)).toEqual([
    "liked000001",
    "favorite001",
    "lateskip001",
    "unknown0001",
    "oldskip0001",
    "skipped0001",
  ]);
  const labels = Object.fromEntries(
    ranked.map((item) => [item.video.id, (item.video as { taste?: string }).taste]),
  );
  expect(labels).toMatchObject({
    favorite001: "écouté 4 fois",
    liked000001: "aimé",
    lateskip001: "déjà écouté",
    skipped0001: "souvent passé vite",
  });
  expect(labels["oldskip0001"]).toBeUndefined();
  // A named artist keeps the search's order and the hidden track.
  const targeted = await tasteService(db).rank(alice, ids.map(candidate), { targeted: true });
  expect(targeted.map((item) => item.video.id)).toEqual(ids);
});

it("lets a dislike come back after the account's delay", async () => {
  await req("PUT", "/taste/feedback/disliked001", tokenA, { value: "dislike" });
  const later = new Date(Date.now() + 6 * 86_400_000);
  const ranked = await tasteService(db).rank(alice, [candidate("disliked001")], { now: later });
  expect(ranked.map((item) => item.video.id)).toEqual(["disliked001"]);
  await req("PUT", "/taste/settings", tokenA, { dislikeDays: 30 });
  expect(await tasteService(db).rank(alice, [candidate("disliked001")], { now: later })).toEqual([]);
});

it("summarises the account's taste: totals, artists and categorised tracks", async () => {
  await db.query(
    `INSERT INTO videos(id,title,channel,thumbnail_url,content_hash,music_metadata) VALUES
     ('cudi0000001','Mr. Rager','KidCudiVEVO','https://i.ytimg.com/vi/cudi0000001/hqdefault.jpg','h1',
      '{"source":"MusicBrainz","status":"matched","artists":[{"id":"1","name":"Kid Cudi","role":"primary"}],"albums":[],"genres":[],"artistGenres":[],"searchText":"","checkedAt":"2026-10-01"}'),
     ('cudi0000002','Pursuit of Happiness','Kid Cudi - Topic','https://i.ytimg.com/vi/cudi0000002/hqdefault.jpg','h2',NULL)`,
  );
  const events = [
    ...Array.from({ length: 6 }, () => play("cudi0000001", "finished")),
    ...Array.from({ length: 3 }, () => play("cudi0000002", "finished")),
    play("yt000000001", "skipped", 3_000),
    play("yt000000001", "skipped", 2_000),
  ];
  await req("POST", "/history", tokenA, { events });
  await req("PUT", "/taste/feedback/cudi0000002", tokenA, { value: "like" });
  await req("PUT", "/taste/feedback/gone0000001", tokenA, { value: "dislike" });
  await req("POST", "/history", tokenB, { events: [play("cudi0000001", "finished")] });

  const overview = await (await req("GET", "/taste/overview")).json();
  expect(overview.summary).toEqual({ tracks: 2, listens: 9, liked: 1, hidden: 1 });
  expect(overview.artists[0]).toMatchObject({ name: "Kid Cudi", tracks: 2, listens: 9 });
  expect(overview.tracks.map((track: { id: string }) => track.id)).toEqual([
    "cudi0000002",
    "cudi0000001",
    "yt000000001",
    "gone0000001",
  ]);
  expect(overview.tracks[0]).toMatchObject({
    title: "Pursuit of Happiness",
    category: "favourite",
    categoryTitle: "Coup de cœur",
    opinion: "like",
    listens: 3,
  });
  expect(overview.tracks[2]).toMatchObject({
    title: "Titre yt000000001",
    category: "unconvinced",
    label: "souvent passé vite",
  });
  expect(overview.tracks[3]).toMatchObject({ category: "hidden", daysLeft: 5, opinion: "dislike" });
  const bobs = await (await req("GET", "/taste/overview", tokenB)).json();
  expect(bobs.summary).toEqual({ tracks: 1, listens: 1, liked: 0, hidden: 0 });
});

it("lists the listener's favourites best first for « ce que j'aime »", async () => {
  const events = [
    ...Array.from({ length: 5 }, () => play("often000001", "finished")),
    play("once0000001", "finished"),
    play("skipped0001", "skipped", 2_000),
    play("skipped0001", "skipped", 2_000),
  ];
  await req("POST", "/history", tokenA, { events });
  await req("PUT", "/taste/feedback/liked000001", tokenA, { value: "like" });
  expect(await tasteService(db).favourites(alice, 10)).toEqual([
    "liked000001",
    "often000001",
    "once0000001",
  ]);
  expect(await tasteService(db).favourites(bob, 10)).toEqual([]);
});
