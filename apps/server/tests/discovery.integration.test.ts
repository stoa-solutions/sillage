import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import { connectMusicMcp } from "../src/music-mcp.ts";
vi.mock("../src/inference-client.ts", () => ({
  infer: vi.fn().mockRejectedValue(new Error("No model in test")),
}));
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "discovery_test";
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema},public`,
});
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "alice-discovery-token-123456789",
  tokenB = "bob-discovery-token-123456789";
let app: ReturnType<typeof createApp>;
let upstream: ReturnType<typeof vi.fn>;
let status = 200;
const video = (id: string) => ({
  id,
  snippet: {
    title: `Discovery ${id}`,
    channelTitle: "Real artist",
    channelId: "channel123",
    description: "Music",
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
  },
  contentDetails: { duration: "PT3M20S" },
  status: { embeddable: true },
});
const req = (path: string, token = tokenA, body?: unknown) =>
  app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  status = 200;
  vi.stubEnv("YOUTUBE_API_KEY", "test-youtube-key");
  vi.stubEnv("DJ_SETTINGS_ENCRYPTION_KEY", "42".repeat(32));
  await db.query(
    "TRUNCATE users,tokens,playlists,videos,jobs,quota_usage CASCADE",
  );
  await db.query(
    "INSERT INTO users(id,google_sub) VALUES($1,'alice'),($2,'bob')",
    [alice, bob],
  );
  for (const [user, token] of [
    [alice, tokenA],
    [bob, tokenB],
  ])
    await db.query(
      "INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'test',$2,$3)",
      [randomUUID(), hash(token), user],
    );
  upstream ??= vi.fn();
  upstream.mockReset();
  upstream.mockImplementation(
    async (input: string | URL, init?: RequestInit) => {
      const address = new URL(String(input));
      if (address.hostname === "www.googleapis.com") {
        if (status !== 200)
          return Response.json(
            { error: { errors: [{ reason: "quotaExceeded" }] } },
            { status },
          );
        if (address.pathname.endsWith("/search"))
          return Response.json({
            items: [
              { id: { videoId: "newtrack001" } },
              { id: { videoId: "newtrack002" } },
            ],
            nextPageToken: "PAGE2",
          });
        if (address.pathname.endsWith("/videos"))
          return Response.json({
            items: (address.searchParams.get("id") ?? "")
              .split(",")
              .filter((id) => id !== "missing0000")
              .map(video),
          });
      }
      if (address.pathname.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        if (!body.tools)
          return Response.json(
            status === 200
              ? { choices: [{ message: { content: "OK" } }] }
              : { error: { message: "secret-provider-body" } },
            { status },
          );
        if (!body.messages.some((m: any) => m.role === "tool"))
          return Response.json({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "s",
                      type: "function",
                      function: {
                        name: "youtube_search",
                        arguments: JSON.stringify({ query: "Real artist" }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "Voici deux découvertes sur YouTube.",
                  trackIds: [],
                  action: "keep",
                  discoveryIds: ["newtrack001"],
                }),
              },
            },
          ],
        });
      }
      throw new Error("Unexpected external request");
    },
  );
  vi.stubGlobal("fetch", upstream);
  app = createApp(db);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
it("authenticates and validates search/add before any provider call", async () => {
  expect(
    (await req("/v1/discover/search", "bad", { query: "jazz" })).status,
  ).toBe(401);
  expect(
    (await req("/v1/discover/search", tokenA, { query: "x" })).status,
  ).toBe(400);
  expect(
    (await req("/v1/discover/add", tokenA, { videoId: "../../etc" })).status,
  ).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
it("adds atomically, deduplicates concurrent saves, scopes ownership and queues indexing", async () => {
  const results = await Promise.all([
    req("/v1/discover/add", tokenA, { videoId: "newtrack001" }),
    req("/v1/discover/add", tokenA, { videoId: "newtrack001" }),
    req("/v1/discover/add", tokenA, { videoId: "newtrack002" }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  expect((await db.query("SELECT * FROM memberships")).rows).toHaveLength(2);
  expect(
    (
      await db.query("SELECT position FROM memberships ORDER BY position")
    ).rows.map((r) => r.position),
  ).toEqual([1, 2]);
  expect(
    (await db.query("SELECT * FROM playlists WHERE sync_enabled")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM jobs WHERE kind='text'")).rows,
  ).toHaveLength(2);
  expect((await (await req("/v1/status")).json()).counts.videos).toBe(2);
  expect((await (await req("/v1/status", tokenB)).json()).counts.videos).toBe(
    0,
  );
  const bobSearch = await (
    await req("/v1/search", tokenB, { query: "Discovery" })
  ).json();
  expect(bobSearch.total).toBe(0);
});
it("caches public search only, recomputes owned flags and supports pagination", async () => {
  await req("/v1/discover/add", tokenA, { videoId: "newtrack001" });
  const first = await (
    await req("/v1/discover/search", tokenA, { query: "cache example" })
  ).json();
  const calls = upstream.mock.calls.length;
  const second = await (
    await req("/v1/discover/search", tokenB, { query: "cache example" })
  ).json();
  expect(upstream.mock.calls.length).toBe(calls);
  expect(first.results[0].inLibrary).toBe(true);
  expect(second.results[0].inLibrary).toBe(false);
  expect(first.nextPageToken).toBe("PAGE2");
  await req("/v1/discover/search", tokenA, {
    query: "cache example",
    pageToken: "PAGE2",
  });
  expect(upstream.mock.calls.length).toBeGreaterThan(calls);
});
it("returns useful quota/missing-video errors without exposing provider data", async () => {
  status = 403;
  const failed = await req("/v1/discover/search", tokenA, {
    query: "quota unique",
  });
  expect(failed.status).toBe(429);
  expect(await failed.text()).not.toContain("test-youtube-key");
  status = 200;
  expect(
    (await req("/v1/discover/add", tokenA, { videoId: "missing0000" })).status,
  ).toBe(404);
  expect((await db.query("SELECT * FROM memberships")).rowCount).toBe(0);
});
it("exposes YouTube only for discovery and restricts library MCP to owned playlists", async () => {
  await req("/v1/discover/add", tokenA, { videoId: "newtrack001" });
  const mcp = await connectMusicMcp(db, [], bob);
  try {
    expect(
      (await mcp.client.listTools()).tools.map((t) => t.name),
    ).not.toContain("youtube_search");
    const result = await mcp.client.callTool({
      name: "library_search",
      arguments: {
        query: "Discovery",
        playlistId: `recall-discoveries:${alice}`,
      },
    });
    expect(JSON.stringify(result)).not.toContain("newtrack001");
  } finally {
    await mcp.close();
  }
});
it("returns verified DJ discovery cards without saving or replacing playback", async () => {
  await req("/v1/dj/settings", tokenA, {
    apiKey: "test-gemini-personal-key",
    model: "gemini-3.5-flash-lite",
  });
  const result = await req("/v1/dj/chat", tokenA, {
    message: "Cherche Real artist sur YouTube",
    scope: "youtube",
  });
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body.action).toBe("keep");
  expect(body.tracks).toEqual([]);
  expect(body.discoveries[0].video.id).toBe("newtrack001");
  expect((await db.query("SELECT * FROM memberships")).rowCount).toBe(0);
});
it("tests draft Gemini keys without persisting them and reports invalid/quota failures", async () => {
  const input = {
    apiKey: "draft-gemini-key-123456789",
    model: "gemini-3.5-flash-lite",
  };
  expect((await (await req("/v1/dj/check", tokenA, input)).json()).ok).toBe(
    true,
  );
  expect((await db.query("SELECT * FROM account_dj_settings")).rowCount).toBe(
    0,
  );
  status = 401;
  const invalid = await (await req("/v1/dj/check", tokenA, input)).json();
  expect(invalid.ok).toBe(false);
  expect(invalid.message).not.toContain("secret-provider-body");
  status = 429;
  expect(
    (await (await req("/v1/dj/check", tokenA, input)).json()).message,
  ).toContain("quota");
});

it("rejects invented discovery IDs and never stores an unverified selection", async () => {
  const normal = upstream.getMockImplementation()!;
  upstream.mockImplementation(async (...args: any[]) => {
    const response = await normal(...args);
    if (String(args[0]).endsWith("/chat/completions")) {
      const body = await response.clone().json();
      if (body.choices?.[0]?.message?.content?.includes("discoveryIds")) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "Résultat inventé",
                  trackIds: [],
                  action: "keep",
                  discoveryIds: ["forgedid001"],
                }),
              },
            },
          ],
        });
      }
    }
    return response;
  });
  await req("/v1/dj/settings", tokenA, {
    apiKey: "test-gemini-personal-key",
    model: "gemini-3.5-flash-lite",
  });
  expect(
    (
      await req("/v1/dj/chat", tokenA, {
        message: "Cherche Real artist sur YouTube",
        scope: "youtube",
      })
    ).status,
  ).toBe(502);
  expect((await db.query("SELECT * FROM memberships")).rowCount).toBe(0);
});
it("keeps the existing encrypted key after a rejected draft check", async () => {
  await req("/v1/dj/settings", tokenA, {
    apiKey: "original-personal-key-test",
    model: "gemini-3.5-flash-lite",
  });
  const before = (
    await db.query("SELECT * FROM account_dj_settings WHERE user_id=$1", [
      alice,
    ])
  ).rows;
  status = 401;
  expect(
    (
      await (
        await req("/v1/dj/check", tokenA, {
          apiKey: "rejected-personal-key-test",
          model: "gemini-3.5-flash-lite",
        })
      ).json()
    ).ok,
  ).toBe(false);
  expect(
    (
      await db.query("SELECT * FROM account_dj_settings WHERE user_id=$1", [
        alice,
      ])
    ).rows,
  ).toEqual(before);
  status = 200;
  const voice = await (
    await req("/v1/dj/check", tokenA, {
      model: "gemini-3.5-flash-lite",
      voice: true,
    })
  ).json();
  expect(voice.ok).toBe(true);
  expect(voice.voice).toBe(false);
  expect(voice.message).toContain("voix Gemini est indisponible");
});
