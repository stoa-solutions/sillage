import { accountRoutes } from "./account-routes.ts";
import { authRoutes, type IdentityProvider } from "./auth.ts";
import { LEGACY_USER, ownsPlaylist, accountProfile } from "./accounts.ts";
import { Hono } from "hono";
import { macosReleases } from "./macos-releases.ts";
import { createDjRoutes, type ApiEnvironment } from "./dj-routes.ts";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { hash, parsePlaylistId } from "./content.ts";
import type { Database } from "./db.ts";
import { enqueue } from "./queue.ts";
import { search } from "./search.ts";
import { importLibrary, videoFromRow } from "./library.ts";
import { parseImport, exportLibrary } from "@playlist-recall/core/import";
import { handleMusicMcp } from "./music-mcp.ts";
import { djPlayerHtml, djPlayerCss, djPlayerJs } from "./dj-player.ts";
export function createApp(db: Database, identityProvider?: IdentityProvider) {
  const app = new Hono<ApiEnvironment>();
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
        return (process.env.ALLOWED_ORIGINS ?? "https://recall.stoa.solutions")
          .split(",")
          .includes(origin)
          ? origin
          : null;
      },
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
      "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self'; frame-src https://www.youtube.com; connect-src https://www.youtube.com; frame-ancestors chrome-extension: http://localhost:* http://127.0.0.1:*",
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
        release: process.env.RELEASE_SHA ?? "local",
      });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  const rate = new Map<string, { minute: number; count: number }>();
  app.use("/v1/*", async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 512)
      return c.json({ error: "Connexion requise." }, 401);
    const tokenHash = hash(authorization.slice(7));
    const found = await db.query(
      "SELECT id,user_id FROM tokens WHERE hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
      [tokenHash],
    );
    if (!found.rowCount)
      return c.json({ error: "Connexion expirée ou jeton invalide." }, 401);
    const minute = Math.floor(Date.now() / 60000);
    const state = rate.get(tokenHash);
    if (state?.minute === minute && state.count >= 180)
      return c.json(
        { error: "Trop de demandes. Réessayez dans une minute." },
        429,
      );
    rate.set(tokenHash, {
      minute,
      count: state?.minute === minute ? state.count + 1 : 1,
    });
    if (rate.size > 1000)
      for (const [key, value] of rate)
        if (value.minute !== minute) rate.delete(key);
    c.header("Cache-Control", "no-store");
    c.set("installationId", found.rows[0].id);
    c.set("userId", found.rows[0].user_id);
    await db.query(
      "UPDATE tokens SET expires_at=now()+interval '90 days' WHERE id=$1 AND expires_at<now()+interval '60 days'",
      [found.rows[0].id],
    );
    await next();
  });
  app.get("/v1/me", async (c) =>
    c.json(await accountProfile(db, c.get("userId"))),
  );
  app.post("/v1/logout", async (c) => {
    await db.query("UPDATE tokens SET revoked_at=now() WHERE id=$1", [
      c.get("installationId"),
    ]);
    return c.json({ saved: true });
  });
  app.route("/v1/account", accountRoutes(db));
  app.route("/v1/dj", createDjRoutes(db));
  app.all("/v1/mcp", (c) => handleMusicMcp(db, c.req.raw, c.get("userId")));
  app.get("/v1/status", async (c) => {
    const counts = (
      await db.query(
        `SELECT count(*)::int AS videos,count(*) FILTER(WHERE title IS NOT NULL)::int AS titled,
      count(*) FILTER(WHERE description<>'')::int AS descriptions,count(*) FILTER(WHERE index_hash=content_hash)::int AS text_indexed,
      (SELECT count(*)::int FROM images i JOIN videos iv ON iv.id=i.video_id WHERE i.source_url=iv.thumbnail_url AND EXISTS(SELECT 1 FROM memberships im WHERE im.video_id=i.video_id AND im.active AND ${ownsPlaylist("im.playlist_id", "$1")})) AS images FROM videos v WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownsPlaylist("m.playlist_id", "$1")})`,
        [c.get("userId")],
      )
    ).rows[0];
    const jobs = (
      await db.query(
        `SELECT kind,status,count(*)::int AS count FROM jobs j WHERE (EXISTS(SELECT 1 FROM user_playlists up WHERE up.user_id=$1 AND up.playlist_id=j.payload->>'playlistId') OR EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=j.payload->>'videoId' AND m.active AND ${ownsPlaylist("m.playlist_id", "$1")})) AND (status IN ('pending','running') OR (status='failed' AND NOT EXISTS(SELECT 1 FROM jobs newer WHERE newer.dedupe_key=j.dedupe_key AND newer.created_at>j.created_at))) GROUP BY kind,status`,
        [c.get("userId")],
      )
    ).rows;
    return c.json({
      counts,
      jobs,
      syncEnabled: process.env.SYNC_ENABLED === "true",
      youtubeConfigured: Boolean(process.env.YOUTUBE_API_KEY),
      visionEnabled: process.env.VISION_ENABLED === "true",
    });
  });
  app.get("/v1/playlists", async (c) =>
    c.json({
      playlists: (
        await db.query(
          `SELECT p.*, (SELECT count(*)::int FROM memberships m WHERE m.playlist_id=p.id AND m.active) AS entries FROM playlists p WHERE ${ownsPlaylist("p.id", "$1")} ORDER BY created_at`,
          [c.get("userId")],
        )
      ).rows,
    }),
  );
  app.post("/v1/playlists", async (c) => {
    const { url } = z
      .object({ url: z.string().min(1).max(500) })
      .parse(await c.req.json());
    const id = parsePlaylistId(url);
    await db.query(
      `INSERT INTO playlists(id,title,source_url) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
      [id, "Nouvelle playlist", `https://www.youtube.com/playlist?list=${id}`],
    );
    await db.query(
      "INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [c.get("userId"), id],
    );
    const job = await enqueue(db, "sync", id, { playlistId: id });
    return c.json({ id, job }, 202);
  });
  app.post("/v1/playlists/:id/sync", async (c) => {
    const id = parsePlaylistId(c.req.param("id"));
    if (
      !(
        await db.query(
          "SELECT 1 FROM user_playlists WHERE playlist_id=$1 AND user_id=$2",
          [id, c.get("userId")],
        )
      ).rowCount
    )
      return c.json({ error: "Playlist inconnue." }, 404);
    return c.json(
      { job: await enqueue(db, "sync", id, { playlistId: id }) },
      202,
    );
  });
  app.post("/v1/search", async (c) => {
    const input = z
      .object({
        query: z.string().max(1000).default(""),
        playlistId: z.string().max(160).optional(),
        excludeIds: z
          .array(z.string().regex(/^[A-Za-z0-9_-]{11}$/))
          .max(100)
          .optional(),
        availableOnly: z.boolean().optional(),
        minDuration: z.number().min(0).optional(),
        maxDuration: z.number().min(0).optional(),
        channel: z.string().max(300).optional(),
        publishedAfter: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        mode: z.enum(["text", "image"]).default("text"),
        sort: z
          .enum(["relevance", "position", "duration"])
          .default("relevance"),
        offset: z.number().int().min(0).max(50000).default(0),
        limit: z.number().int().min(1).max(100).default(48),
      })
      .parse(await c.req.json());
    return c.json(await search(db, input, c.get("userId")));
  });
  app.post("/v1/jobs/retry", async (c) => {
    if (c.get("userId") !== LEGACY_USER)
      return c.json({ error: "Action réservée à la maintenance." }, 403);
    const result = await db.query(
      `UPDATE jobs j SET status='pending',attempts=0,error=NULL,available_at=now(),completed_at=NULL WHERE status='failed' AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.dedupe_key=j.dedupe_key AND active.status IN ('pending','running')) AND id=(SELECT newest.id FROM jobs newest WHERE newest.dedupe_key=j.dedupe_key ORDER BY created_at DESC LIMIT 1)`,
    );
    return c.json({ retried: result.rowCount }, 202);
  });
  app.post("/v1/import", async (c) => {
    if (c.get("userId") !== LEGACY_USER)
      return c.json(
        { error: "Ajoute une playlist avec son lien YouTube." },
        403,
      );
    const data = parseImport(await c.req.json());
    await importLibrary(db, data);
    return c.json({
      playlists: data.playlists.length,
      videos: data.videos.length,
    });
  });
  app.get("/v1/export", async (c) => {
    const playlists = (
      await db.query(
        `SELECT * FROM playlists p WHERE ${ownsPlaylist("p.id", "$1")}`,
        [c.get("userId")],
      )
    ).rows.map((p) => ({
      id: p.id,
      title: p.title,
      sourceUrl: p.source_url,
      importedAt: p.created_at.toISOString(),
    }));
    const videos = (
      await db.query(
        `SELECT * FROM videos v WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownsPlaylist("m.playlist_id", "$1")})`,
        [c.get("userId")],
      )
    ).rows.map(videoFromRow);
    const memberships = (
      await db.query(
        `SELECT * FROM memberships m WHERE active AND ${ownsPlaylist("m.playlist_id", "$1")}`,
        [c.get("userId")],
      )
    ).rows.map((m) => ({
      key: m.key,
      playlistId: m.playlist_id,
      videoId: m.video_id,
      position: m.position,
    }));
    return c.json(exportLibrary({ playlists, videos, memberships }));
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
