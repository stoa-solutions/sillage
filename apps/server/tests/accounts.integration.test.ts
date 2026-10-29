import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { replayBaseline } from "./support/database.ts";
import { required } from "./support/required.ts";
import { hash } from "../src/shared/content.ts";
import { createApp } from "../src/app.ts";
import { pkceChallenge, type IdentityProvider } from "../src/modules/auth/index.ts";
import { LEGACY_USER_ID } from "../src/db/index.ts";
import { personalDjConfig, openSecret } from "../src/modules/dj/dj-settings.service.ts";
import { musicTracks, connectMusicMcp } from "../src/modules/mcp/index.ts";
import { TEXT_KEY, VISION_KEY } from "../src/modules/indexing/index.ts";
import { reserveDj } from "../src/modules/dj/index.ts";
import { recentlyHeard } from "../src/modules/history/index.ts";
vi.mock("../src/integrations/inference/client.ts", () => ({
  infer: vi.fn().mockImplementation(async (kind: string) => ({
    vector: Array(kind === "visual-query" ? 768 : 384).fill(0.01),
  })),
}));
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
// Separate schema avoids interference with the existing worker integration suite.
const schema = "accounts_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
const alice = randomUUID(),
  bob = randomUUID();
const tokenA = "alice-test-session-token-123456",
  tokenB = "bob-test-session-token-123456";
const provider: IdentityProvider = {
  authorize: (state, nonce) =>
    "https://accounts.google.com/test?" + new URLSearchParams({ state, nonce }),
  verify: async (code, nonce) => {
    if (!["valid", "new-user"].includes(code) || !nonce)
      throw new Error("invalid");
    return code === "new-user"
      ? { sub: "google-new", email: "new@example.test", name: "New" }
      : { sub: "google-alice", email: "alice@example.test", name: "Alice" };
  },
};
const app = createApp(db, provider);
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
});
beforeEach(async () => {
  vi.stubEnv("DJ_SETTINGS_ENCRYPTION_KEY", "42".repeat(32));
  vi.stubEnv("DJ_API_KEY", "owner-server-secret-must-not-be-shared");
  await db.query(
    "TRUNCATE users,tokens,playlists,videos,jobs,oauth_flows,oauth_grants CASCADE",
  );
  await db.query(
    `INSERT INTO users(id,google_sub,email) VALUES($1,'google-alice','alice@example.test'),($2,'google-bob','bob@example.test'),($3,NULL,NULL)`,
    [alice, bob, LEGACY_USER_ID],
  );
  await db.query(
    `INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A',$2,$3),($4,'B',$5,$6)`,
    [randomUUID(), hash(tokenA), alice, randomUUID(), hash(tokenB), bob],
  );
  await db.query(
    `INSERT INTO playlists(id,title,source_url) VALUES('PLalice12345','Alice privée','https://www.youtube.com/playlist?list=PLalice12345'),('PLbob1234567','Bob privée','https://www.youtube.com/playlist?list=PLbob1234567')`,
  );
  await db.query(
    `INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLalice12345'),($2,'PLbob1234567')`,
    [alice, bob],
  );
  await db.query(
    `INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES('alicevideo1','Jazz Alice','Alice','https://i.ytimg.com/vi/alicevideo1/hqdefault.jpg','hash-a'),('bobvideo123','Jazz Bob','Bob','https://i.ytimg.com/vi/bobvideo123/hqdefault.jpg','hash-b'),('shared12345','Jazz commun','Shared','https://i.ytimg.com/vi/shared12345/hqdefault.jpg','hash-s')`,
  );
  await db.query(
    `INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('a','PLalice12345','alicevideo1',1,1),('b','PLbob1234567','bobvideo123',1,1),('sa','PLalice12345','shared12345',2,1),('sb','PLbob1234567','shared12345',99,1)`,
  );
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  vi.unstubAllEnvs();
});
it("isolates browsing, text search, pagination, counts, exports and shared-video memberships", async () => {
  for (const [token, own, other] of [
    [tokenA, "PLalice12345", "PLbob1234567"],
    [tokenB, "PLbob1234567", "PLalice12345"],
  ]) {
    const playlists = await (await req("/v1/playlists", token)).json();
    expect(playlists.playlists.map((p: any) => p.id)).toEqual([own]);
    expect((await (await req("/v1/status", token)).json()).counts.videos).toBe(
      2,
    );
    for (const query of ["", "Jazz"]) {
      const result = await (
        await req("/v1/search", token, { query, limit: 100 })
      ).json();
      expect(result.total).toBe(2);
      expect(
        result.results.flatMap((r: any) =>
          r.memberships.map((m: any) => m.playlistId),
        ),
      ).toEqual([own, own]);
      const forged = await (
        await req("/v1/search", token, { query, playlistId: other })
      ).json();
      expect(forged.total).toBe(0);
    }
    const page = await (
      await req("/v1/search", token, { query: "", limit: 1, offset: 1 })
    ).json();
    expect(page.total).toBe(2);
    expect(page.results).toHaveLength(1);
    const exported = JSON.stringify(
      await (await req("/v1/export", token)).json(),
    );
    expect(exported).toContain(own);
    expect(exported).not.toContain(other);
    expect(
      (await req("/v1/playlists/" + other + "/sync", token, {})).status,
    ).toBe(404);
    expect((await req("/v1/import", token, {})).status).toBe(403);
    expect((await req("/v1/jobs/retry", token, {})).status).toBe(403);
  }
});
it("isolates MCP browsing/search and final DJ candidate validation", async () => {
  const mcp = await connectMusicMcp(db, [], alice);
  try {
    const overview = JSON.stringify(
      await mcp.client.callTool({ name: "library_browse", arguments: {} }),
    );
    expect(overview).toContain("Alice privée");
    expect(overview).not.toContain("Bob privée");
    const search = JSON.stringify(
      await mcp.client.callTool({
        name: "library_search",
        arguments: { query: "Jazz" },
      }),
    );
    expect(search).toContain("alicevideo1");
    expect(search).not.toContain("bobvideo123");
    expect(
      (await musicTracks(db, ["bobvideo123", "shared12345"], alice)).map(
        (t) => t.id,
      ),
    ).toEqual(["shared12345"]);
  } finally {
    await mcp.close();
  }
});
it("browses one account's library by date added, by playlist name, artist or genre", async () => {
  await db.query(`UPDATE memberships SET added_at=CASE video_id
    WHEN 'alicevideo1' THEN '2019-03-01'::timestamptz
    WHEN 'shared12345' THEN '2024-06-01'::timestamptz END`);
  await db.query(`UPDATE videos SET music_metadata='{"status":"matched","artists":[{"name":"Erykah Badu"}],"genres":["Neo Soul"]}'::jsonb WHERE id='shared12345'`);
  const mcp = await connectMusicMcp(db, [], alice, false, "library");
  const browse = async (args: Record<string, unknown>) =>
    JSON.parse(required(((await mcp.client.callTool({ name: "library_browse", arguments: args })).content as { text: string }[])[0], "MCP content").text);
  try {
    const oldest = await browse({ order: "oldest" });
    expect(oldest.tracks.map((t: { id: string }) => t.id)).toEqual(["alicevideo1", "shared12345"]);
    expect(oldest.tracks[0].addedAt).toBe("2019-03-01");
    expect(JSON.stringify(oldest)).not.toContain("bobvideo123");
    expect(JSON.stringify(oldest.playlists)).not.toContain("Bob privée");
    expect((await browse({ order: "recent", limit: 1 })).tracks[0].id).toBe("shared12345");
    expect((await browse({ playlist: "alice privee" })).playlist).toBe("Alice privée");
    expect((await browse({ playlist: "Bob privée" })).note).toContain("No playlist matches");
    expect((await browse({ artist: "badu" })).tracks.map((t: { id: string }) => t.id)).toEqual(["shared12345"]);
    expect((await browse({ genre: "soul" })).tracks.map((t: { id: string }) => t.id)).toEqual(["shared12345"]);
    expect((await browse({ genre: "100%" })).tracks).toEqual([]);
    // Forgotten: added long ago and not heard lately; a recent listen takes a track out.
    const forgotten = async () =>
      (await browse({ order: "forgotten" })).tracks.map((t: { id: string }) => t.id).sort();
    expect(await forgotten()).toEqual(["alicevideo1", "shared12345"]);
    await db.query(
      `INSERT INTO listening_history(user_id,event_id,video_id,title,outcome,played_at) VALUES
       ($1,$2,'shared12345','Shared','finished',now() - interval '1 day'),
       ($1,$3,'alicevideo1','Alice','finished',now() - interval '2 days'),
       ($1,$4,'shared12345','Shared','finished',now() - interval '3 days')`,
      [alice, randomUUID(), randomUUID(), randomUUID()],
    );
    expect(await forgotten()).toEqual([]);
    expect(await recentlyHeard(db.orm, alice, 5)).toEqual(["shared12345", "alicevideo1"]);
    expect(await recentlyHeard(db.orm, bob, 5)).toEqual([]);
  } finally {
    await mcp.close();
  }
});
it("encrypts personal keys per account, shares settings only across own sessions, and never falls back to owner key", async () => {
  expect((await personalDjConfig(db, bob)).configured).toBe(false);
  for (const [token, secret] of [
    [tokenA, "alice-personal-test-secret"],
    [tokenB, "bob-personal-test-secret"],
  ])
    expect(
      (
        await req("/v1/dj/settings", token, {
          apiKey: secret,
          model: "gemini-3.5-flash-lite",
          userId: alice,
        })
      ).status,
    ).toBe(200);
  expect((await personalDjConfig(db, alice)).key).toBe(
    "alice-personal-test-secret",
  );
  expect((await personalDjConfig(db, bob)).key).toBe(
    "bob-personal-test-secret",
  );
  const row = (
    await db.query(
      "SELECT encrypted_key FROM account_dj_settings WHERE user_id=$1",
      [alice],
    )
  ).rows[0];
  expect(row.encrypted_key).not.toContain("alice-personal");
  expect(() =>
    openSecret(row.encrypted_key, bob, Buffer.from("42".repeat(32), "hex")),
  ).toThrow();
  const second = "alice-second-session-test-token";
  await db.query(
    `INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A2',$2,$3)`,
    [randomUUID(), hash(second), alice],
  );
  expect((await (await req("/v1/dj/status", second)).json()).personal).toBe(
    true,
  );
  expect(
    JSON.stringify(await (await req("/v1/dj/status", tokenA)).json()),
  ).not.toContain("secret");
  await req("/v1/dj/settings/reset", tokenA, {});
  expect((await personalDjConfig(db, alice)).configured).toBe(false);
  expect((await personalDjConfig(db, bob)).key).toBe(
    "bob-personal-test-secret",
  );
  expect((await req("/v1/dj/chat", tokenA, { message: "Jazz" })).status).toBe(
    503,
  );
});
it("keeps daily DJ budgets separate and revokes only the logged-out session", async () => {
  vi.stubEnv("DJ_DAILY_REQUEST_LIMIT", "1");
  await reserveDj(db, alice);
  await expect(reserveDj(db, alice)).rejects.toThrow("plafond");
  await reserveDj(db, bob);
  expect((await req("/v1/logout", tokenA, {})).status).toBe(200);
  expect((await req("/v1/me", tokenA)).status).toBe(401);
  expect((await req("/v1/me", tokenB)).status).toBe(200);
  await db.query(
    `UPDATE tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1`,
    [bob],
  );
  expect((await req("/v1/me", tokenB)).status).toBe(401);
});
it("resolves requested titles in order without AI, including queued tracks, and never another account's song", async () => {
  await db.query(
    "UPDATE videos SET title='Masego - Navajo',channel='Masego' WHERE id='alicevideo1'",
  );
  await db.query(
    "UPDATE videos SET title='FKJ & Masego - Tadow',channel='FKJ' WHERE id='shared12345'",
  );
  await db.query(
    "UPDATE videos SET title='Secret Song',channel='Bob' WHERE id='bobvideo123'",
  );
  const result = await req("/v1/dj/chat", tokenA, {
    message: "Joue Masego Navajo puis FKJ et Masego Tadow",
    excludeIds: ["alicevideo1"],
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    action: "replace",
    source: "catalog",
    tracks: [{ id: "alicevideo1" }, { id: "shared12345" }],
  });
  const reversed = await req("/v1/dj/chat", tokenA, {
    message: "Joue Tadow puis Navajo",
  });
  expect((await reversed.json()).tracks.map((t: any) => t.id)).toEqual([
    "shared12345",
    "alicevideo1",
  ]);
  const missing = await req("/v1/dj/chat", tokenA, {
    message: "Joue Navajo puis Secret Song",
  });
  expect(await missing.json()).toMatchObject({ action: "keep", tracks: [] });
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM account_dj_usage WHERE user_id=$1",
        [alice],
      )
    ).rows[0].count,
  ).toBe(0);
});
it("ranks an artist's exact song ahead of type beats and other titles in the library and MCP", async () => {
  await db.query(
    "UPDATE videos SET title='Self Care',channel='Mac Miller - Topic' WHERE id='alicevideo1'",
  );
  await db.query(
    "UPDATE videos SET title='Mac Miller Type Beat - Dysphoria',channel='Producer' WHERE id='shared12345'",
  );
  for (const query of ["Mac Miller", "Mac Miller Self Care"]) {
    const result = await req("/v1/search", tokenA, { query });
    expect((await result.json()).results[0].video.id).toBe("alicevideo1");
    const mcp = await connectMusicMcp(db, [], alice);
    try {
      const response = await mcp.client.callTool({
        name: "library_search",
        arguments: { query },
      });
      expect(JSON.parse((response.content as any)[0].text).tracks[0].id).toBe(
        "alicevideo1",
      );
    } finally {
      await mcp.close();
    }
  }
});
it("raises only the configured account's limit and keeps its usage history", async () => {
  vi.stubEnv("DJ_DAILY_REQUEST_LIMIT", "1");
  vi.stubEnv("DJ_ACCOUNT_DAILY_LIMITS", JSON.stringify({ [alice]: 3 }));
  try {
    await reserveDj(db, alice);
    await reserveDj(db, alice);
    await reserveDj(db, alice);
    await expect(reserveDj(db, alice)).rejects.toThrow("Sillage (3");
    await reserveDj(db, bob);
    await expect(reserveDj(db, bob)).rejects.toThrow("Sillage (1");
    expect(
      (
        await db.query(
          "SELECT requests FROM account_dj_usage WHERE user_id=$1",
          [alice],
        )
      ).rows[0].requests,
    ).toBe(3);
  } finally {
    vi.stubEnv("DJ_ACCOUNT_DAILY_LIMITS", "{}");
  }
});
it("lets a temporarily unlimited account keep counting beyond its budget", async () => {
  vi.stubEnv("DJ_DAILY_REQUEST_LIMIT", "1");
  vi.stubEnv(
    "DJ_ACCOUNT_DAILY_LIMITS",
    JSON.stringify({
      [alice]: { limit: 1, unlimitedUntil: "2099-01-01T00:00:00Z" },
    }),
  );
  try {
    await reserveDj(db, alice);
    await reserveDj(db, alice);
    expect(
      (
        await db.query(
          "SELECT requests FROM account_dj_usage WHERE user_id=$1",
          [alice],
        )
      ).rows[0].requests,
    ).toBe(2);
    await reserveDj(db, bob);
    await expect(reserveDj(db, bob)).rejects.toThrow("plafond");
  } finally {
    vi.stubEnv("DJ_ACCOUNT_DAILY_LIMITS", "{}");
  }
});
async function loginStart() {
  const verifier = randomBytes(32).toString("base64url"),
    appState = randomBytes(32).toString("base64url");
  const start = await app.request(
    "/auth/google/start?" +
      new URLSearchParams({
        challenge: pkceChallenge(verifier),
        app_state: appState,
      }),
  );
  const location = new URL(start.headers.get("location")!);
  return {
    verifier,
    appState,
    state: location.searchParams.get("state")!,
    cookie: required(start.headers.get("set-cookie")?.split(";")[0], "session cookie"),
  };
}
it("binds Google callback to browser state and app PKCE; grants are single-use and Google subject stable", async () => {
  const flow = await loginStart();
  expect(
    (await app.request("/auth/google/callback?code=valid&state=" + flow.state))
      .status,
  ).toBe(400);
  const callback = await app.request(
    "/auth/google/callback?code=valid&state=" + flow.state,
    { headers: { Cookie: flow.cookie } },
  );
  expect(callback.status).toBe(200);
  expect(callback.headers.get("cache-control")).toBe("no-store");
  expect(callback.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await callback.text();
  expect(html).toContain("Ouvrir Sillage");
  const location = new URL(required(html.match(/id="return" href="([^"]+)"/)?.[1], "return link").replaceAll("&amp;", "&"));
  expect(location.searchParams.get("state")).toBe(flow.appState);
  expect(location.searchParams.has("token")).toBe(false);
  const code = location.searchParams.get("code")!;
  expect(
    (
      await req("/auth/exchange", "", {
        code,
        verifier: randomBytes(32).toString("base64url"),
      })
    ).status,
  ).toBe(401);
  const exchanged = await req("/auth/exchange", "", {
    code,
    verifier: flow.verifier,
  });
  expect(exchanged.status).toBe(200);
  const token = (await exchanged.json()).token;
  expect((await (await req("/v1/me", token)).json()).id).toBe(alice);
  expect(
    (await req("/auth/exchange", "", { code, verifier: flow.verifier })).status,
  ).toBe(401);
  expect(
    (
      await app.request(
        "/auth/google/callback?code=valid&state=" + flow.state,
        { headers: { Cookie: flow.cookie } },
      )
    ).status,
  ).toBe(400);
});
it("rejects expired/invalid Google flows and expired grants", async () => {
  const flow = await loginStart();
  await db.query("UPDATE oauth_flows SET expires_at=now()-interval '1 second'");
  expect(
    (
      await app.request(
        "/auth/google/callback?code=valid&state=" + flow.state,
        { headers: { Cookie: flow.cookie } },
      )
    ).status,
  ).toBe(400);
  const invalid = await loginStart();
  expect(
    (
      await app.request(
        "/auth/google/callback?code=forged&state=" + invalid.state,
        { headers: { Cookie: invalid.cookie } },
      )
    ).status,
  ).toBe(400);
  const code = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO oauth_grants(code_hash,user_id,challenge,expires_at) VALUES($1,$2,$3,now()-interval '1 second')`,
    [hash(code), alice, pkceChallenge(flow.verifier)],
  );
  expect(
    (await req("/auth/exchange", "", { code, verifier: flow.verifier })).status,
  ).toBe(401);
});
it("requires proof to claim the historical library and permits only one claim", async () => {
  const legacyToken = "legacy-private-connection-token";
  await db.query(
    `INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'legacy',$2,$3)`,
    [randomUUID(), hash(legacyToken), LEGACY_USER_ID],
  );
  await db.query(
    `INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLbob1234567')`,
    [LEGACY_USER_ID],
  );
  expect(
    (await req("/v1/account/claim-library", tokenA, { legacyToken: tokenB }))
      .status,
  ).toBe(403);
  expect(
    (await req("/v1/account/claim-library", tokenA, { legacyToken })).status,
  ).toBe(200);
  expect(
    (await req("/v1/account/claim-library", tokenB, { legacyToken })).status,
  ).toBe(403);
  expect((await (await req("/v1/me", legacyToken)).json()).id).toBe(alice);
});
it("new imports belong only to the importing account, even on migration reruns", async () => {
  expect(
    (
      await req("/v1/playlists", tokenA, {
        url: "https://www.youtube.com/playlist?list=PLnew123456789",
      })
    ).status,
  ).toBe(202);
  expect(
    JSON.stringify(await (await req("/v1/playlists", tokenB)).json()),
  ).not.toContain("PLnew123456789");
  await replayBaseline(db);
  expect(
    (
      await db.query(
        "SELECT 1 FROM user_playlists WHERE user_id=$1 AND playlist_id=$2",
        [LEGACY_USER_ID, "PLnew123456789"],
      )
    ).rowCount,
  ).toBe(0);
});

it("scopes semantic text and image hits before ranking, including explanations", async () => {
  const vector = "[" + Array(384).fill(0.01).join(",") + "]";
  const image = "[" + Array(768).fill(0.01).join(",") + "]";
  await db.query(
    `INSERT INTO passages(video_id,ordinal,text,source_hash,model_key,embedding) SELECT id,0,title,content_hash,$1,$2::vector FROM videos`,
    [TEXT_KEY, vector],
  );
  await db.query(`UPDATE videos SET image_hash=content_hash`);
  await db.query(
    `INSERT INTO images(video_id,source_hash,source_url,model_key,embedding) SELECT id,content_hash,thumbnail_url,$1,$2::vector FROM videos`,
    [VISION_KEY, image],
  );
  for (const mode of ["text", "image"]) {
    const response = await (
      await req("/v1/search", tokenA, { query: "quiet evening", mode })
    ).json();
    expect(response.degraded).toBeNull();
    expect(response.total).toBe(2);
    expect(JSON.stringify(response)).not.toContain("Bob");
    expect(response.results.every((r: any) => r.semantic)).toBe(true);
    if (mode === "image") {
      const mcp = await connectMusicMcp(db, [], alice);
      try {
        const result = await mcp.client.callTool({ name: "library_search", arguments: {
          query: "blue album cover", mode: "image", includeQueued: true,
        } });
        const data = JSON.parse(required((result.content as { text: string }[])[0], "MCP content").text);
        expect(data.mode).toBe("image");
        expect(data.tracks.map((t: any) => t.id).sort()).toEqual(["alicevideo1", "shared12345"]);
        expect(JSON.stringify(data)).not.toContain("bobvideo123");
        expect(data.tracks.every((t: any) => t.matchReason === "Rapprochement visuel")).toBe(true);
      } finally { await mcp.close(); }
    }
  }
});
it("creates a genuinely empty account for a new Google subject, with no inherited key or library", async () => {
  const flow = await loginStart();
  const callback = await app.request(
    "/auth/google/callback?code=new-user&state=" + flow.state,
    { headers: { Cookie: flow.cookie } },
  );
  const html = await callback.text();
  const code = new URL(required(html.match(/id="return" href="([^"]+)"/)?.[1], "return link").replaceAll("&amp;", "&")).searchParams.get("code");
  const token = (
    await (
      await req("/auth/exchange", "", { code, verifier: flow.verifier })
    ).json()
  ).token;
  expect((await (await req("/v1/playlists", token)).json()).playlists).toEqual(
    [],
  );
  expect((await (await req("/v1/status", token)).json()).counts.videos).toBe(0);
  expect((await (await req("/v1/dj/status", token)).json()).configured).toBe(
    false,
  );
  expect((await (await req("/v1/me", token)).json()).id).not.toBe(alice);
});

it("uses each account key for chat and voice requests and blocks unowned model selections", async () => {
  vi.stubEnv("DJ_DAILY_REQUEST_LIMIT", "100");
  for (const [token, apiKey] of [
    [tokenA, "alice-personal-test-secret"],
    [tokenB, "bob-personal-test-secret"],
  ]) {
    await req("/v1/dj/settings", token, {
      apiKey,
      model: "gemini-3.5-flash-lite",
    });
  }
  const outbound: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      outbound.push(
        headers.get("x-goog-api-key") ?? headers.get("Authorization") ?? "",
      );
      if (url.includes("-tts:generateContent"))
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: "audio/pcm", data: Buffer.alloc(20).toString("base64"),
        } }] } }] });
      const body = JSON.parse(String(init.body));
      const hasResult = body.contents.some((message: any) => message.parts.some((part: any) => part.functionResponse));
      return Response.json({candidates:[{index:0,finishReason:"STOP",content:{role:"model",parts:hasResult
        // A malicious/incorrect model tries Bob's track while Alice is signed in.
        ? [{text:JSON.stringify({reply:"Voici la suite",trackIds:["bobvideo123"],action:"replace"})}]
        : [{functionCall:{id:"search",name:"music_search",args:{query:"Jazz"}},thoughtSignature:"opaque-fixture"}],
      }}]});
    }),
  );
  try {
    expect(
      (await req("/v1/dj/chat", tokenA, { message: "Du jazz" })).status,
    ).toBe(502);
    expect(
      (await req("/v1/dj/chat", tokenB, { message: "Du jazz" })).status,
    ).toBe(200);
    for (const token of [tokenA, tokenB]) {
      const voice = await req("/v1/dj/speech", token, { text: "On continue." });
      expect(voice.status).toBe(200);
      expect(
        Buffer.from((await voice.json()).audio, "base64")
          .subarray(0, 4)
          .toString(),
      ).toBe("RIFF");
    }
    expect(outbound).toEqual([
      "alice-personal-test-secret",
      "alice-personal-test-secret",
      "bob-personal-test-secret",
      "bob-personal-test-secret",
      "alice-personal-test-secret",
      "bob-personal-test-secret",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("scopes the public HTTP MCP endpoint to the authenticated user", async () => {
  const response = await app.request("/v1/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokenA,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "library_browse", arguments: {} },
    }),
  });
  expect(response.status).toBe(200);
  const result = JSON.stringify(await response.json());
  expect(result).toContain("Alice privée");
  expect(result).not.toContain("Bob privée");
});
it("returns a nearby heard featuring name only when requested, within the owning account", async () => {
  await db.query(`INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES
    ('hedges00001','Incapable (feat. HEDGES)','Jewel Usain','https://i.ytimg.com/vi/hedges00001/default.jpg','test'),
    ('hedges00002','Another song (feat. HEDGES)','Private Bob','https://i.ytimg.com/vi/hedges00002/default.jpg','test')`);
  await db.query(`INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES
    ('ha','PLalice12345','hedges00001',3,1),('hb','PLbob1234567','hedges00002',3,1)`);
  const mcp = await connectMusicMcp(db, [], alice);
  try {
    for (const [fuzzy, expected] of [[false, []], [true, ['hedges00001']]] as const) {
      const result = await mcp.client.callTool({ name: 'library_search', arguments: { query: 'Edge', fuzzy } });
      const data = JSON.parse(required((result.content as { text: string }[])[0], "MCP content").text);
      expect(data.tracks.map((t: any) => t.id)).toEqual(expected);
    }
    const result = await mcp.client.callTool({ name: 'library_search', arguments: { query: 'Incapable' } });
    const data = JSON.parse(required((result.content as { text: string }[])[0], "MCP content").text);
    expect(data.tracks.map((t: any) => t.id)).toEqual(['hedges00001']);
  } finally { await mcp.close(); }
});
