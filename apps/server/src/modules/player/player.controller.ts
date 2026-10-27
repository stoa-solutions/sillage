import { createRoute, z } from "@hono/zod-openapi";
import {
  commonErrors,
  featureRouter,
  operation,
  textResponse,
} from "../../shared/openapi.ts";
import { djPlayerCss, djPlayerHtml, djPlayerJs } from "./player.assets.ts";

const TAG = "Lecteur et distribution";
const description =
  "Ressource publique utilisée par WebKit ; ne reçoit aucun jeton privé ni clé Gemini. Les contrôles du lecteur ne sont pas des endpoints REST. Le paramètre native=1 active le mode discret prévu par l’app.";
const asset = (
  path: string,
  operationId: string,
  mime: string,
  summary: string,
) =>
  createRoute({
    method: "get",
    path,
    ...operation({ operationId, tag: TAG, summary, description, public: true }),
    ...(path === "/dj/player"
      ? { request: { query: z.object({ native: z.enum(["1"]).optional() }) } }
      : {}),
    responses: { ...commonErrors(true), 200: textResponse(mime, summary) },
  });

/**
 * The public YouTube player page the Mac app embeds. Static assets with their own security
 * headers: documented here, served by plain handlers.
 */
export function playerRoutes() {
  const app = featureRouter();
  for (const route of [
    asset("/dj/player", "getYouTubePlayer", "text/html", "Lecteur public YouTube"),
    asset("/dj/player.js", "getYouTubePlayerScript", "text/javascript", "Script du lecteur"),
    asset("/dj/player.css", "getYouTubePlayerStyle", "text/css", "Style du lecteur"),
  ])
    app.openAPIRegistry.registerPath(route);
  app.get("/dj/player", (c) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self'; frame-src https://www.youtube.com; connect-src https://www.youtube.com; frame-ancestors http://localhost:* http://127.0.0.1:*",
    );
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return c.html(djPlayerHtml);
  });
  app.get("/dj/player.js", (c) =>
    c.body(djPlayerJs, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    }),
  );
  app.get("/dj/player.css", (c) =>
    c.body(djPlayerCss, 200, { "Content-Type": "text/css; charset=utf-8" }),
  );
  return app;
}
