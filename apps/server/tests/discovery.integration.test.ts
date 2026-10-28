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
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import { connectMusicMcp } from "../src/modules/mcp/index.ts";
import { required } from "./support/required.ts";
vi.mock("../src/integrations/inference/client.ts", () => ({
  infer: vi.fn().mockRejectedValue(new Error("No model in test")),
}));
const googleResponse = (parts: unknown[]) => Response.json({candidates:[{index:0,finishReason:"STOP",content:{role:"model",parts}}]});
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "discovery_test";
const admin = new pg.Pool({ connectionString: url });
const createPool = () => openDatabase({ url, schema });
let db = createPool();
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
    categoryId: "10",
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  await db.end();
});
// Each case models a fresh service instance: public cache and quota cooldown
// must not outlive the fixture while its database rows are reset.
beforeEach(async () => {
  db = createPool();
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
  ] as const)
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
            { error: { errors: [{ reason: status === 429 ? "rateLimitExceeded" : "quotaExceeded" }], details: [{ metadata: { quota_limit: "defaultSearchListPerDayPerProject" } }] } },
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
      if (address.hostname === "music.youtube.com") {
        const credit = { text: "Real artist", navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } } };
        const song = (videoId: string, title: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId }, flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [credit, { text: " • 3:00" }] } } },
        ] } });
        return Response.json({ contents: [song("newtrack001", "First new"), song("newtrack002", "Second new")] });
      }
      if (address.pathname.endsWith(":generateContent")) {
        const body = JSON.parse(String(init?.body));
        if (!body.tools) return status === 200 ? googleResponse([{text:"OK"}])
          : Response.json({error:{message:"secret-provider-body"}},{status});
        if (!body.contents.some((message: any) => message.parts.some((part: any) => part.functionResponse)))
          return googleResponse([{functionCall:{id:"s",name:"music_search",args:{query:"Real artist"}},thoughtSignature:"opaque-fixture"}]);
        return googleResponse([{text:JSON.stringify({reply:"Voici deux découvertes sur YouTube.",trackIds:[],action:"keep",discoveryIds:["newtrack001"]})}]);
      }
      throw new Error("Unexpected external request");
    },
  );
  vi.stubGlobal("fetch", upstream);
  app = createApp(db);
});
afterEach(async () => {
  await db.end();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
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
        playlistId: `sillage-discoveries:${alice}`,
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
  status = 400;
  const invalid = await (await req("/v1/dj/check", tokenA, input)).json();
  expect(invalid.ok).toBe(false);
  expect(invalid.message).toContain("clé");
  expect(invalid.message).not.toContain("secret-provider-body");
  status = 429;
  expect(
    (await (await req("/v1/dj/check", tokenA, input)).json()).message,
  ).toContain("quota");
});

it("rejects invented discovery IDs and never stores an unverified selection", async () => {
  const normal = upstream.getMockImplementation() as (
    ...args: any[]
  ) => Promise<Response>;
  upstream.mockImplementation(async (...args: any[]) => {
    const response = await normal(...args);
    if (String(args[0]).endsWith(":generateContent")) {
      const body = await response.clone().json();
      if (body.candidates?.[0]?.content?.parts?.[0]?.text?.includes("discoveryIds")) {
        return googleResponse([{text:JSON.stringify({
                  reply: "Résultat inventé",
                  trackIds: [],
                  action: "keep",
                  discoveryIds: ["forgedid001"],
                })}]);
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

it("preserves a model's chosen subset when it uses the ordinary trackIds field", async () => {
  const normal = upstream.getMockImplementation() as (
    ...args: any[]
  ) => Promise<Response>;
  upstream.mockImplementation(async (...args: any[]) => {
    const response = await normal(...args);
    if (String(args[0]).endsWith(":generateContent")) {
      const body = await response.clone().json();
      if (body.candidates?.[0]?.content?.parts?.[0]?.text?.includes("discoveryIds")) {
        return googleResponse([{text:JSON.stringify({
                  reply: "Uniquement le titre demandé",
                  trackIds: ["newtrack001"],
                  action: "keep",
                })}]);
      }
    }
    return response;
  });
  await req("/v1/dj/settings", tokenA, {
    apiKey: "test-gemini-personal-key",
    model: "gemini-3.5-flash-lite",
  });
  const result = await req("/v1/dj/chat", tokenA, {
    message: "Cherche Real artist sur YouTube, sans le deuxième titre",
    scope: "youtube",
  });
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body.discoveries.map((x: any) => x.video.id)).toEqual(["newtrack001"]);
  expect(body.tracks).toEqual([]);
});

it.each([
  ["Mets Real artist sur YouTube", "replace", "append"],
  ["du Real artist stp", "replace", "append"],
  ["Ajoute Real artist à la suite", "append", "replace"],
  ["Cherche Real artist sur YouTube", "keep", "replace"],
])("honors message intent for %s even if the provider proposes the wrong action", async (message, expected, proposed) => {
  const normal = upstream.getMockImplementation() as (...args: any[]) => Promise<Response>;
  upstream.mockImplementation(async (...args: any[]) => {
    const response = await normal(...args);
    if (String(args[0]).endsWith(":generateContent")) {
      const body = await response.clone().json();
      if (body.candidates?.[0]?.content?.parts?.[0]?.text) {
        return googleResponse([{text:JSON.stringify({reply:"Sélection vérifiée",trackIds:["newtrack001"],action:proposed})}]);
      }
    }
    return response;
  });
  await req("/v1/dj/settings", tokenA, { apiKey: "test-gemini-personal-key", model: "gemini-3.5-flash-lite" });
  const result = await req("/v1/dj/chat", tokenA, { message, scope: "all" });
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body.action).toBe(expected);
  expect(body.tracks.map((t: any) => t.id)).toEqual(expected === "keep" ? [] : ["newtrack001"]);
  if (expected === "keep") expect(body.discoveries.map((t: any) => t.video.id)).toEqual(["newtrack001"]);
  // Playback of a public result never silently adds it to either user's library.
  expect((await db.query("SELECT * FROM memberships")).rowCount).toBe(0);
});

it("excludes queued public tracks from automatic discovery but permits explicit replay", async () => {
  const mcp = await connectMusicMcp(db, ["newtrack001"], alice, true);
  try {
    for (const includeQueued of [false, true]) {
      const result = await mcp.client.callTool({ name: "youtube_search", arguments: { query: "Real artist", includeQueued } });
      const text = required((result.content as {text: string}[])[0], "MCP content").text;
      expect(JSON.parse(text).results.map((r: any) => r.video.id)).toEqual(includeQueued ? ["newtrack001", "newtrack002"] : ["newtrack002"]);
    }
  } finally { await mcp.close(); }
});
it("exposes only public DJ rules to authenticated accounts, without configuration secrets", async () => {
  expect((await req("/v1/dj/rules", "invalid-token")).status).toBe(401);
  const response = await req("/v1/dj/rules");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["prompt"]);
  expect(body.prompt).toContain("DJ personnel");
  expect(body.prompt).not.toContain("test-youtube-key");
});

it("daily search quota remains explicit on later queries without another provider call", async () => {
  status = 429;
  const first = await req("/v1/discover/search", tokenA, { query: "afro" });
  expect(first.status).toBe(429);
  expect((await first.json()).error).toContain("quotidien");
  const calls = upstream.mock.calls.length;
  const next = await req("/v1/discover/search", tokenA, { query: "afrobeat" });
  expect(next.status).toBe(429);
  expect(upstream.mock.calls.length).toBe(calls);
});

it("switches from playlists to Partout on the next chat request without retaining the old scope", async () => {
  await req("/v1/discover/add", tokenA, { videoId: "newtrack001" });
  await req("/v1/dj/settings", tokenA, { apiKey: "test-gemini-personal-key", model: "gemini-3.5-flash-lite" });
  const youtubeSearches = () => upstream.mock.calls.filter(([url]) => String(url).includes("youtube/v3/search")).length;
  const local = await req("/v1/dj/chat", tokenA, { message: "Cherche Real artist", scope: "library" });
  expect(local.status).toBe(200);
  expect(youtubeSearches()).toBe(0);
  const everywhere = await req("/v1/dj/chat", tokenA, { message: "Cherche Real artist", scope: "all" });
  expect(everywhere.status).toBe(200);
  expect(youtubeSearches()).toBe(1);
  expect((await everywhere.json()).discoveries[0].video.id).toBe("newtrack001");
});

it("uses SearXNG through authenticated discovery and MCP, keeping cached ownership private", async () => {
  // A fresh service is constructed after selecting the provider.
  vi.stubEnv("SEARXNG_URL", "http://searxng:8080");
  await db.end();
  db = createPool();
  const original = upstream.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
  upstream.mockImplementation(
    async (input: string | URL, init?: RequestInit) => {
      const address = new URL(String(input));
      if (address.hostname === "searxng")
        return Response.json({
          results: [
            { url: "https://www.youtube.com/watch?v=newtrack001" },
            { url: "https://www.youtube.com/watch?v=newtrack002" },
          ],
          unresponsive_engines: [],
        });
      if (address.pathname.endsWith("/search"))
        throw new Error("Official search quota must not be used");
      return original(input, init);
    },
  );
  app = createApp(db);
  expect(
    (await req("/v1/discover/add", tokenA, { videoId: "newtrack001" })).status,
  ).toBe(200);
  const first = await (
    await req("/v1/discover/search", tokenA, { query: "Searx fixture" })
  ).json();
  const count = upstream.mock.calls.length;
  const second = await (
    await req("/v1/discover/search", tokenB, { query: "Searx fixture" })
  ).json();
  expect(first.results.map((r: any) => r.video.id)).toEqual([
    "newtrack001",
    "newtrack002",
  ]);
  expect(first.results[0].inLibrary).toBe(true);
  expect(second.results[0].inLibrary).toBe(false);
  expect(first.nextPageToken).toBeNull();
  expect(upstream.mock.calls.length).toBe(count);
  const mcp = await connectMusicMcp(db, [], bob, true, "all");
  try {
    const result = await mcp.client.callTool({
      name: "music_search",
      arguments: { query: "Searx fixture" },
    });
    expect(JSON.stringify(result)).toContain("newtrack002");
  } finally {
    await mcp.close();
  }
});

it("personalizes Discover only from this account's history and respects history deletion", async () => {
  await db.query(`INSERT INTO listening_history(user_id,event_id,video_id,title,channel,outcome,played_at)
    VALUES($1,$2,'played00001','Previous song','Real artist','finished',now())`, [alice,randomUUID()]);
  expect((await req('/v1/discover/home','bad')).status).toBe(401);
  expect((await req('/v1/discover/scene?genre=cumbia','bad')).status).toBe(401);
  expect((await req('/v1/discover/scene?genre=x')).status).toBe(400);
  expect((await req('/v1/discover/artist')).status).toBe(400);
  const personal = await (await req('/v1/discover/home')).json();
  expect(personal.basedOn).toEqual(['Real artist']);
  expect(personal.suggestions).toHaveLength(2);
  const other = await (await req('/v1/discover/home',tokenB)).json();
  expect(other.suggestions).toEqual([]);expect(other.basedOn).toEqual([]);
  await req('/v1/history',tokenA); // Reading history never consumes it.
  await app.request('/v1/history',{method:'DELETE',headers:{Authorization:'Bearer '+tokenA}});
  expect((await (await req('/v1/discover/home')).json()).suggestions).toEqual([]);
});
