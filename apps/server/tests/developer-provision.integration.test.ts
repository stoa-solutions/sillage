import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { migrate, openDatabase } from "../src/db/index.ts";
import { createApp } from "../src/app.ts";
import { hash } from "../src/content.ts";
import { provisionDeveloperToken } from "../src/api-docs/developer-provision.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "developer_provision_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
const scoped = new URL(url);
scoped.searchParams.set("options", `-c search_path=${schema},public`);
const alice = randomUUID(),
  bob = randomUUID(),
  id = randomUUID();
const credential = "sillage_dev_" + "a".repeat(43);

function authorize(email = "alice@example.test", tokenHash = hash(credential)) {
  return new Promise<{ userId: string; expiresAt: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", provisionDeveloperToken],
        {
          env: { ...process.env, DATABASE_URL: scoped.toString() },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(JSON.parse(output))
          : reject(new Error("Provisioning rejected")),
      );
      child.stdin.end(JSON.stringify({ id, hash: tokenHash, email }));
    },
  );
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE users,tokens,playlists CASCADE");
  await db.query(
    "INSERT INTO users(id,google_sub,email) VALUES($1,'alice','alice@example.test'),($2,'bob','bob@example.test')",
    [alice, bob],
  );
  await db.query(
    "INSERT INTO playlists(id,title,source_url) VALUES('alice_playlist','Alice',''),('bob_playlist','Bob','')",
  );
  await db.query(
    "INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'alice_playlist'),($2,'bob_playlist')",
    [alice, bob],
  );
  await db.query(
    "INSERT INTO tokens(id,name,hash,user_id,expires_at) VALUES($1,'App Alice',$2,$3,now()+interval '90 days')",
    [randomUUID(), hash("alice-app-session-unchanged"), alice],
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("creates one hashed, expiring session for the chosen account and is safe to retry", async () => {
  expect((await authorize()).userId).toBe(alice);
  expect((await authorize()).userId).toBe(alice);
  const { rows } = await db.query(
    "SELECT hash,user_id,expires_at FROM tokens WHERE id=$1",
    [id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].hash).toBe(hash(credential));
  expect(rows[0].hash).not.toBe(credential);
  expect(rows[0].expires_at.getTime()).toBeGreaterThan(
    Date.now() + 89 * 86400_000,
  );
  const response = await createApp(db).request("/v1/playlists", {
    headers: { Authorization: `Bearer ${credential}` },
  });
  expect(response.status).toBe(200);
  expect(
    (await response.json()).playlists.map((p: { id: string }) => p.id),
  ).toEqual(["alice_playlist"]);
});

it("cannot reassign an existing token to another account or replace its hash", async () => {
  await authorize();
  await expect(authorize("bob@example.test")).rejects.toThrow("rejected");
  await expect(authorize("alice@example.test", "b".repeat(64))).rejects.toThrow(
    "rejected",
  );
  expect(
    (await db.query("SELECT user_id,hash FROM tokens WHERE id=$1", [id]))
      .rows[0],
  ).toEqual({ user_id: alice, hash: hash(credential) });
});

it("requires an existing Google account and revokes independently of the Mac session", async () => {
  await expect(authorize("unknown@example.test")).rejects.toThrow("rejected");
  await authorize();
  const app = createApp(db);
  const headers = { Authorization: `Bearer ${credential}` };
  expect(
    (await app.request("/v1/logout", { method: "POST", headers })).status,
  ).toBe(200);
  expect((await app.request("/v1/me", { headers })).status).toBe(401);
  expect(
    (
      await app.request("/v1/me", {
        headers: { Authorization: "Bearer alice-app-session-unchanged" },
      })
    ).status,
  ).toBe(200);
  await expect(authorize()).rejects.toThrow("rejected");
});
