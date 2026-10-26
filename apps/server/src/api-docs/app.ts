import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openapi, type Method } from "./openapi.ts";
import { postmanCollection, postmanEnvironment } from "./artifacts.ts";
import type { DeveloperConnection } from "./developer-access.ts";

interface DeveloperAccess {
  read(): Promise<DeveloperConnection | null>;
  clear(): Promise<void>;
}

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
  developer?: DeveloperAccess,
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
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sillage — API développeur</title><link rel="stylesheet" href="/assets/swagger-ui.css"><link rel="stylesheet" href="/docs.css"></head><body><header><strong>Sillage · API développeur</strong><span>Local uniquement</span><nav><a href="/downloads/openapi.json" download="sillage.openapi.json">OpenAPI JSON</a><a href="/postman.json" download="Sillage.postman_collection.json">Collection Postman</a><a href="/environment.json" download="Developpement.postman_environment.json">Environnement</a></nav></header><section class="guide"><strong id="developer">Vérification de l’accès développeur…</strong> <button id="revoke" hidden>Révoquer l’accès développeur</button><p>Les essais ciblent <code id="target"></code>. La connexion de développement est utilisée automatiquement par Swagger et Postman sur ce Mac. Les écritures et les appels fournisseur ont leurs effets réels ; aucun accès administrateur global.</p><p><small>Sans accès de développement : <code>npm run docs:connect -- --email=ton-compte-google</code>. Authorize reste disponible pour utiliser manuellement une autre session Sillage.</small></p></section><div id="swagger-ui"></div><script src="/assets/swagger-ui-bundle.js"></script><script src="/assets/swagger-ui-standalone-preset.js"></script><script src="/config.js"></script></body></html>`,
    ),
  );
  app.get("/config.js", (c) =>
    c.body(
      `document.getElementById("target").textContent=${JSON.stringify(upstream.origin)};window.ui=SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",deepLinking:true,filter:true,docExpansion:"none",persistAuthorization:false,validatorUrl:null,displayRequestDuration:true,tryItOutEnabled:false,supportedSubmitMethods:["get","post","delete"],presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"BaseLayout"});async function status(){const r=await fetch("/developer/status");const s=await r.json();document.getElementById("developer").textContent=s.configured?"Connecté en développement · "+s.email:"Accès développeur à configurer sur ce Mac";document.getElementById("revoke").hidden=!s.configured;}status().catch(()=>{document.getElementById("developer").textContent="Accès développeur indisponible";});document.getElementById("revoke").onclick=async()=>{const r=await fetch("/developer/revoke",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(r.ok)await status();else document.getElementById("developer").textContent="Révocation non confirmée ; réessaie.";};`,
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
    c.json(
      postmanEnvironment(
        "Sillage — Développement sur ce Mac",
        "http://127.0.0.1:" + new URL(c.req.url).port + "/proxy",
      ),
    ),
  );
  app.get("/developer/status", async (c) => {
    try {
      const connection = await developer?.read();
      return c.json(
        connection
          ? { configured: true, email: connection.email }
          : { configured: false },
      );
    } catch {
      return c.json(
        { configured: false, error: "Accès développeur indisponible." },
        503,
      );
    }
  });
  app.post("/developer/revoke", async (c) => {
    if (c.req.header("content-type") !== "application/json")
      return c.json({ error: "Corps JSON attendu." }, 400);
    try {
      const connection = await developer?.read();
      if (!connection) return c.json({ saved: true });
      const result = await request(new URL("/v1/logout", upstream), {
        method: "POST",
        headers: { Authorization: `Bearer ${connection.token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (result.status !== 401 && (!result.ok || !(await result.json()).saved))
        return c.json({ error: "Révocation non confirmée." }, 502);
      await developer!.clear();
      return c.json({ saved: true });
    } catch {
      return c.json({ error: "Révocation non confirmée." }, 502);
    }
  });
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
      if (
        operation.security?.length !== 0 &&
        !headers
          .get("authorization")
          ?.replace(/^Bearer\s*/i, "")
          .trim()
      ) {
        const connection = await developer?.read();
        if (!connection)
          return c.json(
            {
              error:
                "Configure l’accès développeur avec npm run docs:connect, ou renseigne une session Sillage dans Authorize.",
            },
            401,
          );
        headers.set("authorization", `Bearer ${connection.token}`);
      }
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
      for (const name of ["content-type", "retry-after", "x-sillage-trace-id", "x-sillage-journal"]) {
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
