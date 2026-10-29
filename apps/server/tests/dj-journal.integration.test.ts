import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/shared/content.ts";
import { createApp } from "../src/app.ts";
import {
  beginJournal,
  closeInterruptedTurns,
  loadConversationMemory,
} from "../src/modules/dj/journal/journal.service.ts";
import { djInput } from "../src/modules/dj/dj.contracts.ts";
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "dj_journal_test",
  admin = new pg.Pool({ connectionString: url }),
  db = openDatabase({ url, schema });
const alice = randomUUID(),
  bob = randomUUID(),
  installation = randomUUID();
const tokenA = "journal-alice-token-123456789",
  tokenB = "journal-bob-token-12345678901";
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
const event = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  sequence: 1,
  occurredAt: "2026-10-26T12:00:00Z",
  scope: "all",
  visibleScope: "youtube",
  kind: "message",
  role: "user",
  content: "Ajoute cinq morceaux comme ça",
  queueIds: ["C7vVkdPEun8"],
  ...overrides,
});
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
    [installation, hash(tokenA), alice, randomUUID(), hash(tokenB), bob],
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
it("stores source, context, tool arguments/results, proposals and final response in one correlated turn", async () => {
  const conversationId = randomUUID(),
    requestId = randomUUID();
  const input = djInput.parse({
    message: "Prépare cinq morceaux",
    scope: "all",
    conversationId,
    requestId,
    trigger: "continuation",
    excludeIds: ["C7vVkdPEun8"],
  });
  const journal = await beginJournal(db, alice, installation, input);
  journal.observe({
    kind: "provider",
    name: "gemini-test",
    status: "ok",
    output: {
      tool_calls: [
        {
          id: "call-1",
          function: {
            name: "music_search",
            arguments: '{"query":"Jewel Usain"}',
          },
        },
      ],
    },
  });
  journal.observe({
    kind: "tool",
    name: "music_search",
    status: "partial",
    input: { query: "Jewel Usain" },
    output: {
      tracks: [
        { id: "C7vVkdPEun8", title: "Incapable", channel: "Jewel Usain" },
      ],
    },
  });
  expect(
    await journal.finish(
      "completed",
      {
        reply: "J’ajoute Incapable",
        action: "append",
        tracks: [{ id: "C7vVkdPEun8", title: "Incapable" }],
      },
      "gemini-test",
    ),
  ).toBe(true);
  const response = await req("GET", "/turns/" + journal.id);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.turn).toMatchObject({
    user_id: alice,
    scope: "all",
    requested_scope: "all",
    request_id: requestId,
    trigger: "continuation",
    status: "completed",
    journal_complete: true,
    model: "gemini-test",
    input: { excludeIds: ["C7vVkdPEun8"] },
    response: { action: "append" },
  });
  expect(data.events.map((e: any) => e.kind)).toEqual(["provider", "tool"]);
  expect(data.events[1].payload).toMatchObject({
    input: { query: "Jewel Usain" },
    status: "partial",
  });
  expect((await req("GET", "/turns/" + journal.id, tokenB)).status).toBe(404);
  expect(
    (await req("GET", `/conversations/${conversationId}/events`, tokenB))
      .status,
  ).toBe(404);
  expect(
    (await (await req("GET", "/conversations", tokenB)).json()).conversations,
  ).toEqual([]);
});
it("retries client batches idempotently, preserving visible/effective sources and actual queue state", async () => {
  const id = randomUUID(),
    entry = event();
  expect(
    await (
      await req("POST", `/conversations/${id}/events`, tokenA, {
        events: [entry],
      })
    ).json(),
  ).toEqual({ recorded: 1 });
  expect(
    await (
      await req("POST", `/conversations/${id}/events`, tokenA, {
        events: [{ ...entry, content: "replacement" }],
      })
    ).json(),
  ).toEqual({ recorded: 0 });
  const events = (
    await (await req("GET", `/conversations/${id}/events`)).json()
  ).events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    scope: "all",
    origin: "client",
    payload: {
      content: entry.content,
      visibleScope: "youtube",
      queueIds: ["C7vVkdPEun8"],
    },
  });
  // Even knowledge of both IDs cannot address Alice's data through Bob's account.
  await req("POST", `/conversations/${id}/events`, tokenB, {
    events: [{ ...entry, content: "Bob" }],
  });
  expect(
    (await (await req("GET", `/conversations/${id}/events`, tokenB)).json())
      .events[0].payload.content,
  ).toBe("Bob");
  expect(
    (await (await req("GET", `/conversations/${id}/events`)).json()).events[0]
      .payload.content,
  ).toBe(entry.content);
  expect(
    (
      await req("POST", `/conversations/${id}/events`, tokenA, {
        events: [event({ kind: "provider" })],
      })
    ).status,
  ).toBe(400);
  expect(
    (await req("GET", `/conversations/${id}/events?after=9999999999999999999`))
      .status,
  ).toBe(400);
});
it("pages events and turns without gaps and deletes only the owner's journal", async () => {
  const id = randomUUID();
  await req("POST", `/conversations/${id}/events`, tokenA, {
    events: Array.from({ length: 5 }, (_, i) => event({ sequence: i + 1 })),
  });
  await req("POST", `/conversations/${id}/events`, tokenB, {
    events: [event()],
  });
  const seen: string[] = [];
  let after = "0";
  do {
    const page = await (
      await req("GET", `/conversations/${id}/events?limit=2&after=${after}`)
    ).json();
    seen.push(...page.events.map((e: any) => e.id));
    after = page.nextCursor;
  } while (after);
  expect(new Set(seen).size).toBe(5);
  expect(seen).toHaveLength(5);
  for (const status of ["completed", "error", "canceled", "busy"] as const) {
    const j = await beginJournal(
      db,
      alice,
      installation,
      djInput.parse({ message: "test", scope: "library", conversationId: id }),
    );
    await j.finish(status, { reply: status });
  }
  const turns: string[] = [];
  let before: string | null = null;
  do {
    const page = await (
      await req(
        "GET",
        `/conversations/${id}/turns?limit=2${before ? "&before=" + before : ""}`,
      )
    ).json();
    turns.push(...page.turns.map((t: any) => t.status));
    before = page.nextCursor;
  } while (before);
  expect(new Set(turns)).toEqual(
    new Set(["completed", "error", "canceled", "busy"]),
  );
  expect((await req("DELETE", `/conversations/${id}`)).status).toBe(200);
  expect((await req("GET", `/conversations/${id}/events`)).status).toBe(404);
  expect((await req("GET", `/conversations/${id}/events`, tokenB)).status).toBe(
    200,
  );
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM dj_turns WHERE user_id=$1",
        [alice],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (await db.query("SELECT count(*)::int AS n FROM tokens")).rows[0].n,
  ).toBe(2);
});
it("records an actual HTTP DJ error without changing its response contract or exposing private details", async () => {
  try {
    const id = randomUUID();
    const response = await req("POST", "/chat", tokenA, {
      message: "parlons un peu",
      scope: "youtube",
      conversationId: id,
      requestId: randomUUID(),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("x-sillage-journal")).toBe("saved");
    const trace = response.headers.get("x-sillage-trace-id");
    expect(trace).toBeTruthy();
    const saved = await (await req("GET", "/turns/" + trace)).json();
    expect(saved.turn).toMatchObject({
      scope: "youtube",
      status: "error",
      journal_complete: true,
      response: { status: 503 },
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it("paginates conversations and rejects another account's conversation cursor", async () => {
  const ids = Array.from({ length: 5 }, () => randomUUID());
  for (const id of ids)
    await req("POST", `/conversations/${id}/events`, tokenA, {
      events: [event()],
    });
  const foreign = randomUUID();
  await req("POST", `/conversations/${foreign}/events`, tokenB, {
    events: [event()],
  });
  const seen: string[] = [];
  let before: string | null = null;
  do {
    const page = await (
      await req(
        "GET",
        `/conversations?limit=2${before ? "&before=" + before : ""}`,
      )
    ).json();
    seen.push(...page.conversations.map((c: any) => c.id));
    before = page.nextCursor;
  } while (before);
  expect(new Set(seen)).toEqual(new Set(ids));
  expect(seen).toHaveLength(5);
  expect(
    (await (await req("GET", `/conversations?before=${foreign}`)).json())
      .conversations,
  ).toEqual([]);
});

it("rebuilds the conversation memory from the journal, including a superseded turn's searches", async () => {
  const conversationId = randomUUID();
  const turn = async (message: string) =>
    beginJournal(db, alice, installation, djInput.parse({ message, conversationId }));
  const first = await turn("Mets du Elvis");
  await first.finish("completed", {
    reply: "C’est parti : My Way.",
    action: "replace",
    tracks: [{ id: "abcdefghijk", title: "My Way" }],
  });
  const forced = await turn("Un mood russe");
  forced.observe({
    kind: "tool",
    name: "music_search",
    status: "ok",
    input: { query: "russian doomer" },
    output: { results: [{ video: { id: "bcdefghijkl", title: "Группа крови" }, inLibrary: false }] },
  });
  await forced.finish("superseded", { error: "remplacé", status: 409 });
  const current = await turn("Plutôt du Basta");
  const memory = await loadConversationMemory(db, alice, conversationId, current.id);
  expect(memory.exchanges).toEqual([
    { request: "Mets du Elvis", trigger: "user", reply: "C’est parti : My Way.", tracks: ["My Way"] },
  ]);
  expect(memory.interrupted).toEqual({
    request: "Un mood russe",
    searches: ["russian doomer"],
    candidates: ["Группа крови"],
  });
  expect((await loadConversationMemory(db, bob, conversationId, current.id)).exchanges).toEqual([]);
});

it("closes turns a restart cut off, so none stays running forever", async () => {
  const running = await beginJournal(db, alice, installation, djInput.parse({ message: "Du jazz" }));
  expect(await closeInterruptedTurns(db)).toBe(1);
  const { rows } = await db.query("SELECT status,response FROM dj_turns WHERE id=$1", [running.id]);
  expect(rows[0]).toMatchObject({ status: "interrupted", response: { status: 503 } });
});
