import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openapi, type Method } from "./openapi.ts";
import { postmanCollection, postmanEnvironment } from "./artifacts.ts";

const require = createRequire(import.meta.url);
const assets = require("swagger-ui-dist").getAbsoluteFSPath() as string;
const assetTypes: Record<string, string> = {
  "swagger-ui.css": "text/css",
  "swagger-ui-bundle.js": "text/javascript",
  "swagger-ui-standalone-preset.js": "text/javascript",
};

/** This app is deliberately separate from createApp: no public docs routes ship. */
export function createDocsApp(
  target = "https://recall.stoa.solutions",
  request: typeof fetch = fetch,
) {
  const upstream = new URL(target);
  if (
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    upstream.pathname !== "/" ||
    !(
      upstream.protocol === "https:" ||
      (upstream.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname))
    )
  )
    throw new Error(
      "RECALL_DOCS_API_URL doit être une origine HTTPS ou une API locale, sans identifiant.",
    );
  const app = new Hono();
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      (c.req.header("origin") && c.req.header("origin") !== url.origin)
    )
      return c.text("Accès local uniquement.", 403);
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
  });
  app.use(
    "/proxy/*",
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) => c.json({ error: "Corps supérieur à 30 Mio." }, 413),
    }),
  );
  app.get("/", (c) =>
    c.html(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sillage — API développeur</title><link rel="stylesheet" href="/assets/swagger-ui.css"><link rel="stylesheet" href="/docs.css"></head><body><header><strong>Sillage · API développeur</strong><span>Local uniquement · aucun secret mémorisé</span><nav><a href="/downloads/openapi.json" download="sillage.openapi.json">OpenAPI JSON</a><a href="/postman.json" download="Sillage.postman_collection.json">Collection Postman</a><a href="/environment.json" download="Serveur.postman_environment.json">Environnement</a></nav></header><p class="guide">Choisis une route pour voir son contrat. <b>Authorize</b> attend un jeton de session Sillage, pas la clé Gemini. Les essais ciblent <code id="target"></code>. Les écritures et les appels fournisseur ont leurs effets réels. La connexion Google se termine dans le navigateur et l’app.</p><div id="swagger-ui"></div><script src="/assets/swagger-ui-bundle.js"></script><script src="/assets/swagger-ui-standalone-preset.js"></script><script src="/config.js"></script></body></html>`,
    ),
  );
  app.get("/config.js", (c) =>
    c.body(
      `document.getElementById("target").textContent=${JSON.stringify(upstream.origin)};window.ui=SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",deepLinking:true,filter:true,docExpansion:"none",persistAuthorization:false,validatorUrl:null,displayRequestDuration:true,tryItOutEnabled:false,supportedSubmitMethods:["get","post","delete"],presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"BaseLayout"});`,
      200,
      { "Content-Type": "text/javascript" },
    ),
  );
  app.get("/docs.css", (c) =>
    c.body(
      "body{margin:0;background:#faf9f6;font-family:system-ui;color:#252525}header{padding:20px 5%;background:#232321;color:white;display:flex;gap:20px;align-items:center;flex-wrap:wrap}header span{font-size:12px;color:#ddd}nav{margin-left:auto;display:flex;gap:20px}nav a{color:#f3ad76;font-size:13px}.guide{max-width:1460px;margin:24px auto;padding:0 20px;font-size:14px;line-height:1.6}.swagger-ui .topbar{display:none}.swagger-ui .info{margin:25px 0}",
      200,
      { "Content-Type": "text/css" },
    ),
  );
  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (!assetTypes[name]) return c.notFound();
    return c.body(await readFile(join(assets, name), "utf8"), 200, {
      "Content-Type": assetTypes[name],
    });
  });
  app.get("/openapi.json", (c) =>
    c.json({
      ...openapi,
      servers: [
        { url: "/proxy", description: `Essais locaux vers ${upstream.origin}` },
      ],
    }),
  );
  app.get("/downloads/openapi.json", (c) => c.json(openapi));
  app.get("/postman.json", (c) => c.json(postmanCollection()));
  app.get("/environment.json", (c) =>
    c.json(postmanEnvironment("Sillage — Serveur privé", upstream.origin)),
  );
  app.all("/proxy/*", async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname.slice("/proxy".length);
    const method = c.req.method.toLowerCase() as Method;
    const route = Object.entries(openapi.paths).find(([pattern]) =>
      new RegExp(
        `^${pattern.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`,
      ).test(path),
    );
    const operation = route?.[1][method];
    if (!operation) return c.json({ error: "Route absente du contrat." }, 404);
    if (
      operation["x-sillage-effect"] === "browser" ||
      path.startsWith("/dj/") ||
      path.startsWith("/macos/")
    )
      return c.json(
        {
          error:
            "Cette route se consulte directement sur le serveur ; le flux Google exige le navigateur et son cookie.",
        },
        400,
      );
    const headers = new Headers();
    for (const name of [
      "accept",
      "authorization",
      "content-type",
      "mcp-protocol-version",
    ]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    try {
      const response = await request(new URL(path + url.search, upstream), {
        method: c.req.method,
        headers,
        body: ["GET", "HEAD"].includes(c.req.method)
          ? undefined
          : await c.req.arrayBuffer(),
        redirect: "manual",
        signal: AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(90_000),
        ]),
      });
      const outgoing = new Headers();
      for (const name of ["content-type", "retry-after"]) {
        const value = response.headers.get(name);
        if (value) outgoing.set(name, value);
      }
      // Never relay OAuth cookies or a redirect that could expose the supplied Bearer.
      if (response.status >= 300 && response.status < 400)
        return c.json(
          { error: "Redirection refusée par la documentation locale." },
          502,
        );
      return new Response(response.body, {
        status: response.status,
        headers: outgoing,
      });
    } catch {
      return c.json(
        {
          error:
            "Le serveur cible ne répond pas ; vérifie son accès puis réessaie.",
        },
        502,
      );
    }
  });
  return app;
}
