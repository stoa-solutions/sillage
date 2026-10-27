import { it, expect, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { createDocsApp } from "../src/api-docs/app.ts";
import { openapi } from "../src/api-docs/openapi.ts";
import { artifacts, postmanCollection } from "../src/api-docs/artifacts.ts";
import type { Database } from "../src/db/index.ts";

const database = {
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
} as unknown as Database;
const server = createApp(database);
const local = "http://127.0.0.1:3030";

it("documents every mounted HTTP operation, including stateless MCP methods", () => {
  const live = new Set(
    server.routes
      .filter((r) => !r.path.includes("*"))
      .flatMap((r) =>
        (r.method === "ALL" ? ["GET", "POST", "DELETE"] : [r.method]).map(
          (method) =>
            `${method} ${r.path.replace(/:([^/]+)/g, "{$1}").replace(/\/$/, "")}`,
        ),
      ),
  );
  const documented = Object.entries(openapi.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
  );
  expect(new Set(documented)).toEqual(live);
  const ids = Object.values(openapi.paths).flatMap((methods) =>
    Object.values(methods).map((op) => op.operationId),
  );
  expect(new Set(ids).size).toBe(ids.length);
});

it("keeps request defaults optional and preserves source and pagination constraints", () => {
  const schemas = openapi.components.schemas;
  expect(schemas.DjRequest.required).toEqual(["message"]);
  expect((schemas.DjRequest.properties as any).scope.enum).toEqual([
    "library",
    "youtube",
    "all",
  ]);
  expect((schemas.LibrarySearch.properties as any).limit.maximum).toBe(100);
  expect((schemas.HistoryPage.properties as any).limit.maximum).toBe(200);
  expect((schemas.DjSettings.properties as any).apiKey.minLength).toBe(20);
  const serialized = JSON.stringify(openapi);
  for (const [, schema] of serialized.matchAll(
    /"\$ref":"#\/components\/schemas\/([^"/]+)"/g,
  ))
    expect(schemas[schema], schema).toBeDefined();
});

it("keeps developer documentation out of the public API and protected routes authenticated", async () => {
  for (const path of ["/docs", "/swagger", "/openapi.json", "/postman.json"])
    expect((await server.request(path)).status).toBe(404);
  expect((await server.request("/v1/me")).status).toBe(401);
  expect(openapi.paths["/health"].get!.security).toEqual([]);
  expect(openapi.paths["/v1/me"].get!.security).toBeUndefined(); // Inherits the global Bearer scheme.
  expect((await server.request("/health")).status).toBe(200);
});

it("exports one Postman request per operation with inherited auth and empty secrets", () => {
  const collection = postmanCollection();
  expect(collection.item.flatMap((group) => group.item).length).toBe(47);
  expect(collection.auth.bearer[0].value).toBe("{{api_token}}");
  for (const item of Object.values(artifacts()))
    expect(JSON.stringify(item)).not.toMatch(/AIza[\w-]{25,}/);
  for (const [path, artifact] of Object.entries(artifacts()))
    if (path.endsWith("environment.json"))
      expect(
        (artifact as any).values.find((v: any) => v.key === "api_token").value,
      ).toBe("");
});

it("serves Swagger and assets locally without CDN, token persistence or external validation", async () => {
  const docs = createDocsApp();
  const response = await docs.request(local);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  const html = await response.text();
  expect(html).toContain("/assets/swagger-ui-bundle.js");
  expect(html).not.toContain("https://");
  expect(await (await docs.request(`${local}/config.js`)).text()).toContain(
    "persistAuthorization:false,validatorUrl:null",
  );
  expect((await docs.request(`${local}/assets/swagger-ui.css`)).status).toBe(
    200,
  );
  expect((await docs.request(`${local}/assets/package.json`)).status).toBe(404);
  const spec = await (await docs.request(`${local}/openapi.json`)).json();
  expect(spec.servers[0].url).toBe("/proxy");
});

it("rejects external host and cross-origin requests before forwarding anything", async () => {
  const forward = vi.fn<typeof fetch>();
  const docs = createDocsApp(undefined, forward);
  expect((await docs.request("http://evil.test/proxy/v1/me")).status).toBe(403);
  expect(
    (
      await docs.request(`${local}/proxy/v1/me`, {
        headers: { Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect((await docs.request(`${local}/proxy/not-an-api`)).status).toBe(404);
  expect((await docs.request(`${local}/proxy/auth/google/start`)).status).toBe(
    400,
  );
  expect(forward).not.toHaveBeenCalled();
  expect(() => createDocsApp("https://user:secret@example.test")).toThrow();
  expect(() => createDocsApp("http://remote.example.test")).toThrow();
});

it("forwards only documented paths to the fixed API, with an explicit Bearer and no browser cookies", async () => {
  const forward = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('{"id":"account-test"}', {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "not-relayed=1",
      },
    }),
  );
  const docs = createDocsApp("https://api.example.test", forward);
  const response = await docs.request(`${local}/proxy/v1/me`, {
    headers: {
      Authorization: "Bearer fixture-token",
      Cookie: "private=not-relayed",
    },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(String(forward.mock.calls[0][0])).toBe(
    "https://api.example.test/v1/me",
  );
  const options = forward.mock.calls[0][1]!;
  expect(new Headers(options.headers).get("authorization")).toBe(
    "Bearer fixture-token",
  );
  expect(new Headers(options.headers).get("cookie")).toBeNull();
  expect(options.redirect).toBe("manual");
});

it("preserves upstream error details but does not follow redirects or expose network diagnostics", async () => {
  const forward = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('{"error":"Quota fournisseur","reason":"quota"}', {
        status: 429,
        headers: { "Retry-After": "60", "Content-Type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.test" },
      }),
    )
    .mockRejectedValueOnce(new Error("secret-network-configuration"));
  const docs = createDocsApp(undefined, forward);
  const authorized = { headers: { Authorization: "Bearer fixture-token" } };
  const limited = await docs.request(`${local}/proxy/v1/me`, authorized);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(await limited.json()).toEqual({
    error: "Quota fournisseur",
    reason: "quota",
  });
  expect((await docs.request(`${local}/proxy/v1/me`, authorized)).status).toBe(
    502,
  );
  const unavailable = await docs.request(`${local}/proxy/v1/me`, authorized);
  expect(unavailable.status).toBe(502);
  expect(await unavailable.text()).not.toContain("secret-network");
});

it("uses the private developer session automatically without sending it to the browser or exports", async () => {
  const access = {
    id: "00000000-0000-4000-8000-000000000002",
    token: "sillage_dev_" + "a".repeat(43),
    email: "dev@example.test",
    url: "https://api.example.test",
    provisioned: true,
  };
  const forward = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response('{"id":"account-test"}', {
          headers: { "Content-Type": "application/json" },
        }),
    );
  const docs = createDocsApp(access.url, forward, {
    read: async () => access,
    clear: vi.fn(),
  });
  const status = await (await docs.request(`${local}/developer/status`)).text();
  expect(status).toContain("dev@example.test");
  expect(status).not.toContain(access.token);
  expect((await docs.request(`${local}/proxy/v1/me`)).status).toBe(200);
  expect(
    new Headers(forward.mock.calls[0][1]!.headers).get("authorization"),
  ).toBe(`Bearer ${access.token}`);
  for (const path of [
    "/",
    "/config.js",
    "/environment.json",
    "/postman.json",
    "/openapi.json",
  ])
    expect(await (await docs.request(local + path)).text()).not.toContain(
      access.token,
    );
});

it("does not use the developer credential for public routes and fails closed when absent", async () => {
  const read = vi.fn(async () => null);
  const forward = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{"ok":true}'));
  const docs = createDocsApp(undefined, forward, { read, clear: vi.fn() });
  expect((await docs.request(`${local}/proxy/health`)).status).toBe(200);
  expect(read).not.toHaveBeenCalled();
  expect((await docs.request(`${local}/proxy/v1/me`)).status).toBe(401);
  expect(forward).toHaveBeenCalledTimes(1);
});

it("revokes only the developer session and keeps the file if the server cannot confirm", async () => {
  const access = {
    id: "00000000-0000-4000-8000-000000000002",
    token: "sillage_dev_" + "a".repeat(43),
    email: "dev@example.test",
    url: "https://api.example.test",
    provisioned: true,
  };
  const clear = vi.fn(async () => {});
  const forward = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('{"error":"unavailable"}', { status: 503 }),
    )
    .mockResolvedValueOnce(new Response('{"saved":true}'));
  const docs = createDocsApp(access.url, forward, {
    read: async () => access,
    clear,
  });
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  };
  expect(
    (await docs.request(`${local}/developer/revoke`, options)).status,
  ).toBe(502);
  expect(clear).not.toHaveBeenCalled();
  expect(
    (await docs.request(`${local}/developer/revoke`, options)).status,
  ).toBe(200);
  expect(clear).toHaveBeenCalledOnce();
  expect(String(forward.mock.calls[0][0])).toBe(access.url + "/v1/logout");
  expect(
    new Headers(forward.mock.calls[0][1]!.headers).get("authorization"),
  ).toBe(`Bearer ${access.token}`);
});


it("preserves journal diagnostics through the local proxy without forwarding private headers", async () => {
  const forward = vi.fn<typeof fetch>().mockResolvedValue(Response.json({reply:"ok",action:"keep",tracks:[]},{headers:{"X-Sillage-Trace-Id":"trace-test","X-Sillage-Journal":"saved","Set-Cookie":"private=example","Authorization":"private"}}));
  const docs = createDocsApp(undefined, forward);
  const response = await docs.request(`${local}/proxy/v1/dj/chat`,{method:"POST",headers:{Authorization:"Bearer fixture-token","Content-Type":"application/json"},body:JSON.stringify({message:"test"})});
  expect(response.headers.get("x-sillage-trace-id")).toBe("trace-test");
  expect(response.headers.get("x-sillage-journal")).toBe("saved");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("authorization")).toBe(false);
});
