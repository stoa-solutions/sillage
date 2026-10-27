import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import {
  BASE_AGENTS,
  djAgentsService,
  syncBaseAgents,
} from "../src/modules/dj-agents/index.ts";
import { writeBaseAgents } from "../src/modules/dj-agents/dj-agents.repository.ts";
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "dj_agents_test",
  admin = new pg.Pool({ connectionString: url }),
  db = openDatabase({ url, schema });
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "agents-alice-token-1234567890",
  tokenB = "agents-bob-token-12345678901";
const app = createApp(db);
const req = (method: string, path: string, token = tokenA, body?: unknown) =>
  app.request("/v1/dj" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const calm = { name: "Soirée calme", instructions: "Réponses courtes et douces." };
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  // Truncating users cascades to every agent, base ones included: write them again.
  await db.query("TRUNCATE users CASCADE");
  await syncBaseAgents(db);
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

it("writes base agents from code at each start: same text keeps its date, edits apply, removed ones go", async () => {
  const before = await (await req("GET", "/agents")).json();
  await syncBaseAgents(db);
  expect(await (await req("GET", "/agents")).json()).toEqual(before);

  const created = await (await req("POST", "/agents", tokenA, calm)).json();
  await writeBaseAgents(db.orm, [
    { key: "dj", name: "Le DJ", instructions: "" },
    { key: "focus", name: "Focus", instructions: "Texte retouché." },
  ]);
  const after = await (await req("GET", "/agents")).json();
  expect(after.agents.map((agent: { id: string }) => agent.id)).toEqual([
    "dj",
    "focus",
    created.id,
  ]);
  expect(after.agents[1]).toMatchObject({
    instructions: "Texte retouché.",
    base: true,
  });
  expect(after.agents[0].updatedAt).toBe(before.agents[0].updatedAt);
});

it("lists base agents in code order, then the account's own, never another account's", async () => {
  const mine = await (await req("POST", "/agents", tokenA, calm)).json();
  expect(mine).toMatchObject({ ...calm, base: false });
  await req("POST", "/agents", tokenB, { name: "Bob", instructions: "Rock." });
  const list = await (await req("GET", "/agents")).json();
  expect(list.defaultId).toBe("dj");
  expect(list.agents.map((agent: { id: string }) => agent.id)).toEqual([
    ...BASE_AGENTS.map((agent) => agent.key),
    mine.id,
  ]);
});

it("edits and deletes only the account's own agents", async () => {
  const mine = await (await req("POST", "/agents", tokenA, calm)).json();
  expect((await req("PUT", "/agents/" + mine.id, tokenB, calm)).status).toBe(404);
  expect((await req("DELETE", "/agents/" + mine.id, tokenB)).status).toBe(404);
  // Base agents are addressed by key, never by an editable uuid.
  expect((await req("PUT", "/agents/focus", tokenA, calm)).status).toBe(400);
  const edited = await req("PUT", "/agents/" + mine.id, tokenA, {
    name: "Soirée",
    instructions: "Encore plus doux.",
  });
  expect(await edited.json()).toMatchObject({ name: "Soirée", instructions: "Encore plus doux." });
  expect((await req("DELETE", "/agents/" + mine.id)).status).toBe(200);
  expect((await req("DELETE", "/agents/" + mine.id)).status).toBe(404);
  expect((await req("POST", "/agents", tokenA, { name: "", instructions: "x" })).status).toBe(400);
});

it("caps custom agents per account", async () => {
  for (let index = 0; index < 20; index++)
    expect(
      (await req("POST", "/agents", tokenA, { name: `Agent ${index}`, instructions: "x" })).status,
    ).toBe(200);
  expect((await req("POST", "/agents", tokenA, calm)).status).toBe(409);
  expect((await req("POST", "/agents", tokenB, calm)).status).toBe(200);
});

it("resolves a turn's agent, falling back to the default for unknown, foreign or deleted ones", async () => {
  const agents = djAgentsService(db);
  const bobs = await (await req("POST", "/agents", tokenB, calm)).json();
  const focus = await agents.resolve(alice, "focus");
  expect(focus.profile?.name).toBe("Focus");
  expect(focus.trace).toMatchObject({ id: "focus", name: "Focus" });
  expect(focus.trace.instructionsHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await agents.resolve(alice, "dj")).toEqual({ trace: { id: "dj" } });
  expect(await agents.resolve(alice)).toEqual({ trace: { id: "dj" } });
  for (const id of [bobs.id, randomUUID(), "inconnu"])
    expect(await agents.resolve(alice, id)).toEqual({ trace: { id, fallback: true } });
});

it("records the agent used by a chat turn in its journal", async () => {
  // Without a configured provider the turn stops after its plan is journaled.
  const response = await req("POST", "/chat", tokenA, {
    message: "mets du jazz",
    agentId: "archiviste",
  });
  expect(response.status).toBe(503);
  const stale = await req("POST", "/chat", tokenA, {
    message: "mets du jazz",
    agentId: randomUUID(),
  });
  expect(stale.status).toBe(503);
  const { rows } = await db.query(
    "SELECT plan->'agent' AS agent FROM dj_turns WHERE user_id=$1 ORDER BY started_at",
    [alice],
  );
  expect(rows[0].agent).toMatchObject({ id: "archiviste", name: "L’Archiviste" });
  expect(rows[1].agent).toMatchObject({ fallback: true });
});
