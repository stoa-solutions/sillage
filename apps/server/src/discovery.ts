import { discoveryHome } from "./discovery-home.ts";
import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { transaction, type Database } from "./db.ts";
import { ownsPlaylist } from "./features/accounts/index.ts";
import { upsertVideo } from "./library.ts";
import { documentText, hash } from "./content.ts";
import { YouTube } from "./youtube.ts";
import { SearxngDiscovery, SearxngError } from "./searxng.ts";
import {
  searchFailureMessage,
  type SearchFailureReason,
} from "./search-feedback.ts";
import { nextYouTubeQuotaReset, YouTubeError } from "./youtube-errors.ts";
import type { ApiEnvironment } from "./shared/api-environment.ts";

export const discoveryInput = z.object({
  query: z.string().trim().min(2).max(200),
  pageToken: z
    .string()
    .max(500)
    .regex(/^[\w=-]*$/)
    .default(""),
});
export type DiscoverySource = Pick<YouTube, "search" | "videos">;
export const discoveryAddInput = z.object({ videoId: z.string().regex(/^[\w-]{11}$/) });
function discoverySource(db: Database): DiscoverySource {
  const youtube = new YouTube(process.env.YOUTUBE_API_KEY ?? "", db);
  const url = process.env.SEARXNG_URL?.trim();
  return url ? new SearxngDiscovery(url, youtube) : youtube;
}
export class DiscoveryError extends Error {
  constructor(
    message: string,
    public status: 404 | 429 | 502 | 503,
    public reason: SearchFailureReason = "unavailable",
    public retryAt?: string,
  ) {
    super(message);
  }
}
/** Public catalog cache only. Ownership is recomputed for every authenticated request. */
export class Discovery {
  private cache = new Map<
    string,
    { until: number; result: Awaited<ReturnType<YouTube["search"]>> }
  >();
  private pending = new Map<
    string,
    Promise<Awaited<ReturnType<YouTube["search"]>>>
  >();
  constructor(
    private db: Database,
    private source: DiscoverySource = discoverySource(db),
  ) {}
  async search(user: string, query: string, pageToken = "") {
    const parsed = discoveryInput.parse({ query, pageToken });
    const key = JSON.stringify([parsed.query.toLowerCase(), parsed.pageToken]);
    let result = this.cache.get(key);
    if (!result || result.until < Date.now()) {
      let request = this.pending.get(key);
      if (!request) {
        if (this.pending.size >= 4)
          throw new DiscoveryError(
            "La recherche YouTube est occupée. Réessaie dans un instant.",
            429,
          );
        request = this.source.search(parsed.query, parsed.pageToken);
        this.pending.set(key, request);
      }
      try {
        const data = await request;
        result = { until: Date.now() + 300000, result: data };
        if (this.cache.size >= 100)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, result);
      } catch (error) {
        throw providerError(error);
      } finally {
        this.pending.delete(key);
      }
    }
    const owned = await this.owned(
      user,
      result.result.videos.map((v) => v.id),
    );
    return {
      results: result.result.videos.map((video) => ({
        video,
        inLibrary: owned.has(video.id),
      })),
      nextPageToken: result.result.nextPageToken,
    };
  }
  async owned(user: string, ids: string[]) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT m.video_id FROM memberships m WHERE m.active AND m.video_id=ANY($2::text[]) AND ${ownsPlaylist("m.playlist_id", "$1")}`,
      [user, ids],
    );
    return new Set<string>(rows.map((row) => row.video_id));
  }
  async add(user: string, id: string) {
    let videos;
    try {
      videos = await this.source.videos([id]);
    } catch (error) {
      throw providerError(error);
    }
    const video = videos.find((v) => v.id === id);
    if (!video)
      throw new DiscoveryError(
        "Cette vidéo est absente ou n’est plus accessible sur YouTube.",
        404,
      );
    const playlistId = `recall-discoveries:${user}`;
    await transaction(this.db, async (client) => {
      // A private collection, never passed to YouTube's playlist synchronizer.
      await client.query(
        `INSERT INTO playlists(id,title,source_url,sync_enabled,status) VALUES($1,'Mes découvertes','',false,'ready') ON CONFLICT(id) DO NOTHING`,
        [playlistId],
      );
      await client.query(`SELECT id FROM playlists WHERE id=$1 FOR UPDATE`, [
        playlistId,
      ]);
      await client.query(
        `INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [user, playlistId],
      );
      await upsertVideo(client, video, true);
      await client.query(
        `INSERT INTO memberships(key,playlist_id,video_id,position,added_at,seen_generation)
        SELECT $1,$2,$3,COALESCE(max(position),0)+1,now(),0 FROM memberships WHERE playlist_id=$2
        ON CONFLICT(key) DO UPDATE SET active=true`,
        [`${playlistId}:${id}`, playlistId, id],
      );
      for (const [kind, key, payload] of [
        ["text", `${id}:${hash(documentText(video))}`, { videoId: id }],
        ...(process.env.VISION_ENABLED === "true"
          ? [["image", id, { videoId: id }]]
          : []),
      ] as [string, string, Record<string, string>][]) {
        await client.query(
          `INSERT INTO jobs(id,kind,dedupe_key,payload) VALUES($1,$2,$3,$4)
          ON CONFLICT(dedupe_key) WHERE status IN ('pending','running') DO NOTHING`,
          [randomUUID(), kind, `${kind}:${key}`, payload],
        );
      }
    });
    return { saved: true, playlistId, video };
  }
}
function providerError(error: unknown): DiscoveryError {
  const message = error instanceof Error ? error.message : "";
  const reason: SearchFailureReason =
    error instanceof SearxngError
      ? error.reason
      : /Budget/.test(message)
        ? "local_budget"
        : error instanceof YouTubeError
          ? error.kind === "rate_limit"
            ? "rate_or_quota"
            : error.kind
          : /quotaExceeded|dailyLimit/i.test(message)
            ? "daily_quota"
            : /Clé YouTube absente/.test(message)
              ? "not_configured"
              : "unavailable";
  const now = Date.now();
  return new DiscoveryError(
    searchFailureMessage({ source: "youtube", reason }, now) +
      " Tes playlists restent disponibles.",
    ["daily_quota", "rate_or_quota", "local_budget"].includes(reason)
      ? 429
      : ["not_configured", "access_denied"].includes(reason)
        ? 503
        : 502,
    reason,
    reason === "daily_quota"
      ? new Date(nextYouTubeQuotaReset(now)).toISOString()
      : undefined,
  );
}
const services = new WeakMap<Database, Discovery>();
export function discoveryFor(db: Database) {
  let service = services.get(db);
  if (!service) {
    service = new Discovery(db);
    services.set(db, service);
  }
  return service;
}
export function discoveryRoutes(db: Database, service = discoveryFor(db)) {
  const routes = new Hono<ApiEnvironment>();
  routes.get("/home", async (c) =>
    c.json(await discoveryHome(db, c.get("userId"), service)),
  );
  routes.post("/search", async (c) => {
    const input = discoveryInput.parse(await c.req.json());
    return c.json(
      await service.search(c.get("userId"), input.query, input.pageToken),
    );
  });
  routes.post("/add", async (c) => {
    const { videoId } = discoveryAddInput.parse(await c.req.json());
    return c.json(await service.add(c.get("userId"), videoId));
  });
  routes.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: "Recherche ou vidéo invalide." }, 400);
    if (error instanceof DiscoveryError)
      return c.json(
        {
          error: error.message,
          source: "youtube",
          reason: error.reason,
          ...(error.retryAt ? { retryAt: error.retryAt } : {}),
        },
        error.status,
      );
    return c.json(
      { error: "L’ajout n’a pas abouti. Réessaie sans risque de doublon." },
      500,
    );
  });
  return routes;
}
