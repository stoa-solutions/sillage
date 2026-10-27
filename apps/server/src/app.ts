import { enrichmentProgress } from "./musicbrainz/rollout.ts";
import { discoveryRoutes } from "./discovery.ts";
import { historyRoutes } from "./history.ts";
import {
  authRoutes,
  sessionGuard,
  type IdentityProvider,
} from "./features/auth/index.ts";
import {
  accountRoutes,
  LEGACY_USER,
  ownsPlaylist,
} from "./features/accounts/index.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { macosReleases } from "./macos-releases.ts";
import type { ApiEnvironment } from "./shared/api-environment.ts";
import { createDjRoutes } from "./features/dj/routes.ts";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { parsePlaylistId } from "./content.ts";
import { transaction, type Database } from "./db/index.ts";
import { jobRoutes } from "./features/jobs/index.ts";
import { libraryRoutes } from "./features/library/index.ts";
import { search } from "./search.ts";
import { librarySearchInput } from "./library-contracts.ts";
import {
  Lrclib,
  lyricsFor,
  setLyricsOffset,
  type LyricsSource,
} from "./lyrics.ts";
import { handleMusicMcp } from "./music-mcp.ts";
import { djPlayerHtml, djPlayerCss, djPlayerJs } from "./dj-player.ts";
export function createApp(
  db: Database,
  identityProvider?: IdentityProvider,
  lyricsSource: LyricsSource = new Lrclib(),
) {
  // OpenAPIHono collects the documented routes of the features mounted below.
  const app = new OpenAPIHono<ApiEnvironment>();
  app.use(
    "*",
    cors({
      origin: (origin) =>
        (process.env["ALLOWED_ORIGINS"] ?? "https://recall.stoa.solutions")
          .split(",")
          .includes(origin)
          ? origin
          : null,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 3600,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) => c.json({ error: "Fichier trop volumineux." }, 413),
    }),
  );
  app.route("/auth", authRoutes(db, identityProvider));
  app.route("/macos", macosReleases());
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
  app.get("/health", async (c) => {
    try {
      await db.query("SELECT 1");
      return c.json({
        ok: true,
        version: "2.2.0",
        release: process.env["RELEASE_SHA"] ?? "local",
      });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  app.use("/v1/*", sessionGuard(db));
  app.route("/v1", accountRoutes(db));
  app.route("/v1/discover", discoveryRoutes(db));
  app.route("/v1/dj", createDjRoutes(db));
  app.route("/v1/history", historyRoutes(db));
  app.all("/v1/mcp", (c) => handleMusicMcp(db, c.req.raw, c.get("userId")));
  app.get("/v1/library/enrichment", async (c) =>
    c.json(await enrichmentProgress(db, c.get("userId"))),
  );
  app.route("/v1", libraryRoutes(db));
  app.route("/v1", jobRoutes(db));
  app.post("/v1/search", async (c) => {
    const input = librarySearchInput.parse(await c.req.json());
    return c.json(await search(db, input, c.get("userId")));
  });
  const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
  app.get("/v1/lyrics/:videoId", async (c) => {
    const lyrics = await lyricsFor(
      db,
      lyricsSource,
      c.get("userId"),
      videoId.parse(c.req.param("videoId")),
    );
    return lyrics
      ? c.json(lyrics)
      : c.json({ error: "Vidéo absente de ta bibliothèque." }, 404);
  });
  app.post("/v1/lyrics/:videoId/offset", async (c) => {
    const { offsetMs } = z
      .object({ offsetMs: z.number().int().min(-30000).max(30000) })
      .parse(await c.req.json());
    const saved = await setLyricsOffset(
      db,
      c.get("userId"),
      videoId.parse(c.req.param("videoId")),
      offsetMs,
    );
    return saved
      ? c.json({ offsetMs })
      : c.json({ error: "Vidéo absente de ta bibliothèque." }, 404);
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: "Données invalides." }, 400);
    if (
      /Identifiant|Utilisez un lien|fichier|playlist JSON|entrée|durée|Durée|Position|sauvegarde|import/i.test(
        error.message,
      )
    )
      return c.json({ error: error.message }, 400);
    console.error("API request failed", error.name);
    return c.json(
      { error: "Le serveur ne peut pas traiter cette demande." },
      500,
    );
  });
  return app;
}
