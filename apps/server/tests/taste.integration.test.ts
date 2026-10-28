import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/content.ts";
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

it("ranks a search from the listener's history and opinions, never another account's", async () => {
  // Bob loves "skipped0001": that must not change Alice's ranking.
  await req("PUT", "/taste/feedback/skipped0001", tokenB, { value: "like" });
  const events = [
    ...Array.from({ length: 4 }, () => play("favorite001", "finished")),
    play("skipped0001", "skipped", 4_000),
    play("skipped0001", "skipped", 6_000),
    play("lateskip001", "skipped", 120_000),
  ];
  expect((await req("POST", "/history", tokenA, { events })).status).toBe(200);
  const { rows } = await db.query(
    "SELECT listened_ms FROM listening_history WHERE user_id=$1 AND video_id='lateskip001'",
    [alice],
  );
  expect(rows[0].listened_ms).toBe(120_000);
  await req("PUT", "/taste/feedback/disliked001", tokenA, { value: "dislike" });
  await req("PUT", "/taste/feedback/liked000001", tokenA, { value: "like" });

  const ranked = await tasteService(db).rank(
    alice,
    ["unknown0001", "skipped0001", "disliked001", "lateskip001", "favorite001", "liked000001"].map(
      candidate,
    ),
  );
  expect(ranked.map((item) => item.video.id)).toEqual([
    "favorite001",
    "liked000001",
    // A late skip is only « next »: no penalty, the search order holds among neutral tracks.
    "unknown0001",
    "lateskip001",
    "skipped0001",
  ]);
  const labels = Object.fromEntries(
    ranked.map((item) => [item.video.id, (item.video as { taste?: string }).taste]),
  );
  expect(labels["favorite001"]).toBe("écouté 4 fois");
  expect(labels["liked000001"]).toBe("aimé");
  expect(labels["skipped0001"]).toContain("souvent passé vite");
  expect(labels["unknown0001"]).toBeUndefined();
});

it("lets a 👎 come back after the account's delay", async () => {
  await req("PUT", "/taste/feedback/disliked001", tokenA, { value: "dislike" });
  const later = new Date(Date.now() + 6 * 86_400_000);
  const ranked = await tasteService(db).rank(alice, [candidate("disliked001")], later);
  expect(ranked.map((item) => item.video.id)).toEqual(["disliked001"]);
  await req("PUT", "/taste/settings", tokenA, { dislikeDays: 30 });
  expect(await tasteService(db).rank(alice, [candidate("disliked001")], later)).toEqual([]);
});
