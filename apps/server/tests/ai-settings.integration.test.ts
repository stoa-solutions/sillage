import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { replayBaseline } from "./support/database.ts";
import { createApp } from "../src/app.ts";
import { hash } from "../src/content.ts";

const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Disposable _test database required");
}
const schema = "ai_settings_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
const alice = randomUUID();
const bob = randomUUID();
const tokenA = "alice-ai-settings-test-token";
const tokenB = "bob-ai-settings-test-token";
const app = createApp(db);
const request = (path: string, body?: unknown, token = tokenA) =>
  app.request(`/v1/dj/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  vi.stubEnv("DJ_SETTINGS_ENCRYPTION_KEY", "42".repeat(32));
  await db.query("TRUNCATE users,playlists,videos CASCADE");
  for (const [id, token] of [
    [alice, tokenA],
    [bob, tokenB],
  ] as const) {
    await db.query("INSERT INTO users(id,email) VALUES($1,$2)", [
      id,
      `${id}@example.test`,
    ]);
    await db.query(
      "INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'test',$2,$3)",
      [randomUUID(), hash(token), id],
    );
  }
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  vi.unstubAllEnvs();
});

it("lets an account select Claude with its own key without exposing the key or configuring another account", async () => {
  const result = await request("settings", {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    apiKey: "fixture-anthropic-key-never-real",
  });
  expect(result.status).toBe(200);
  const status = await (await request("status")).json();
  expect(status).toMatchObject({
    configured: true,
    personal: true,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    voice: false,
  });
  expect(JSON.stringify(status)).not.toContain("fixture-anthropic");
  expect(
    await (await request("status", undefined, tokenB)).json(),
  ).toMatchObject({ configured: false });
});

it.runIf(Boolean(process.env["AI_SIMULATION_URL"]))(
  "checks saved keys through both native APIs and preserves each key when switching or removing a provider",
  async () => {
    vi.stubEnv(
      "AI_GOOGLE_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/google/v1beta`,
    );
    vi.stubEnv(
      "AI_ANTHROPIC_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/anthropic/v1`,
    );
    for (const [provider, model, apiKey] of [
      ["google", "gemini-3.8-flash", "fixture-google-key-never-real"],
      ["anthropic", "claude-sonnet-5-5", "fixture-anthropic-key-never-real"],
    ]) {
      expect(
        (await request("settings", { provider, model, apiKey })).status,
      ).toBe(200);
      expect(
        await (await request("check", { provider, model })).json(),
      ).toMatchObject({ ok: true });
    }
    expect(
      (
        await request("settings", {
          provider: "google",
          model: "gemini-3.8-flash",
        })
      ).status,
    ).toBe(200);
    expect(
      await (await request("check", { model: "gemini-3.8-flash" })).json(),
    ).toMatchObject({ ok: true });
    expect(
      (await request("settings/reset", { provider: "anthropic" })).status,
    ).toBe(200);
    expect(
      await (await request("check", { model: "gemini-3.8-flash" })).json(),
    ).toMatchObject({ ok: true });
    expect(
      await (
        await request("check", {
          provider: "anthropic",
          model: "claude-sonnet-5-5",
        })
      ).json(),
    ).toMatchObject({ ok: false });
  },
);

it.runIf(Boolean(process.env["AI_SIMULATION_URL"]))(
  "executes the same music tools over native Gemini and Claude HTTP APIs, then returns a verified selection",
  async () => {
    vi.stubEnv(
      "AI_GOOGLE_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/google/v1beta`,
    );
    vi.stubEnv(
      "AI_ANTHROPIC_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/anthropic/v1`,
    );
    await db.query(
      "INSERT INTO playlists(id,title,source_url) VALUES('PLai1234567','Jazz','https://www.youtube.com/playlist?list=PLai1234567')",
    );
    await db.query(
      "INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLai1234567')",
      [alice],
    );
    await db.query(
      "INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES('jazzvideo01','Jazz du soir','Jazz','https://i.ytimg.com/vi/jazzvideo01/hqdefault.jpg','fixture')",
    );
    await db.query(
      "INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('ai','PLai1234567','jazzvideo01',1,1)",
    );
    for (const [provider, model, apiKey] of [
      ["google", "gemini-3.8-flash", "fixture-google-key-never-real"],
      ["anthropic", "claude-sonnet-5-5", "fixture-anthropic-key-never-real"],
    ]) {
      await request("settings", { provider, model, apiKey });
      const response = await request("chat", {
        message: "SIMULATE_NATIVE du jazz pour ce soir",
        scope: "library",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "replace",
        source: "mcp",
        tracks: [{ id: "jazzvideo01" }],
      });
      const limited = await request("chat", {
        message: "SIMULATE_QUOTA",
        scope: "library",
      });
      expect(limited.status).toBe(429);
      expect(await limited.text()).not.toMatch(/private-fixture|fixture-.*key/);
    }
  },
);

it.runIf(Boolean(process.env["AI_SIMULATION_URL"]))(
  "migrates an existing Google key and selected model without re-entry or reset on a second migration",
  async () => {
    vi.stubEnv(
      "AI_GOOGLE_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/google/v1beta`,
    );
    await request("settings", {
      model: "gemini-3.8-flash",
      apiKey: "fixture-google-key-never-real",
    });
    // Recreate the pre-upgrade storage state using the legacy client's saved credential.
    await db.query("DELETE FROM account_ai_credentials");
    await db.query("DELETE FROM schema_migrations WHERE version=3");
    await replayBaseline(db);
    await replayBaseline(db);
    expect(await (await request("status")).json()).toMatchObject({
      provider: "google",
      model: "gemini-3.8-flash",
      configured: true,
    });
    expect(
      await (await request("check", { model: "gemini-3.8-flash" })).json(),
    ).toMatchObject({ ok: true });
    expect(
      (
        await request("settings", {
          provider: "anthropic",
          model: "claude-sonnet-5-5",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("settings", {
          provider: "anthropic",
          model: "gemini-3.8-flash",
          apiKey: "fixture-anthropic-key-never-real",
        })
      ).status,
    ).toBe(400);
    expect(await (await request("status")).json()).toMatchObject({
      provider: "google",
      configured: true,
    });
  },
);

it.runIf(Boolean(process.env["AI_SIMULATION_URL"])).each(["google", "compatible"])(
  "keeps the initial %s legacy server check working but never reactivates its global key after personal configuration",
  async (transport) => {
    const legacy = "00000000-0000-4000-8000-000000000001";
    vi.stubEnv("DJ_PROVIDER", transport === "compatible" ? "" : "google");
    vi.stubEnv("DJ_BASE_URL", `${process.env["AI_SIMULATION_URL"]}/google/v1`);
    vi.stubEnv("DJ_MODEL", "gemini-3.8-flash");
    vi.stubEnv("DJ_API_KEY", "fixture-google-key-never-real");
    vi.stubEnv(
      "AI_GOOGLE_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/google/v1beta`,
    );
    vi.stubEnv(
      "AI_ANTHROPIC_BASE_URL",
      `${process.env["AI_SIMULATION_URL"]}/anthropic/v1`,
    );
    await db.query("INSERT INTO users(id) VALUES($1)", [legacy]);
    await db.query(
      "INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'legacy',$2,$3)",
      [randomUUID(), hash("legacy-ai-settings-token"), legacy],
    );
    await db.query("DELETE FROM schema_migrations WHERE version=3");
    await replayBaseline(db);
    const send = (path: string, body?: unknown) =>
      request(path, body, "legacy-ai-settings-token");
    expect(await (await send("status")).json()).toMatchObject({
      configured: true,
      personal: false,
    });
    expect(
      await (await send("check", { model: "gemini-3.8-flash" })).json(),
    ).toMatchObject({ ok: true });
    await send("settings", {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      apiKey: "fixture-anthropic-key-never-real",
    });
    await send("settings/reset", { provider: "anthropic" });
    expect(await (await send("status")).json()).toMatchObject({
      configured: false,
      provider: "anthropic",
    });
    await replayBaseline(db);
    expect(await (await send("status")).json()).toMatchObject({
      configured: false,
      provider: "anthropic",
    });
    await send("settings/reset", {});
    expect(await (await send("status")).json()).toMatchObject({
      configured: false,
    });
  },
);
