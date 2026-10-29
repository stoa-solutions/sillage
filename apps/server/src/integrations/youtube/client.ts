import { sql } from "drizzle-orm";
import { quotaUsage, type Database } from "../../db/index.ts";
import { isoDuration } from "../../shared/content.ts";
import type { Video } from "@sillage/core/types";
export interface PlaylistEntry {
  key: string;
  videoId: string;
  position: number;
  addedAt: string | null;
  title: string | null;
  channel: string | null;
}
import {
  YouTubeError,
  youtubeError,
  nextYouTubeQuotaReset,
} from "./errors.ts";
type Fetcher = typeof fetch;
export class YouTube {
  private exhausted = new Map<string, { until: number; error: YouTubeError }>();
  constructor(
    private key: string,
    private db?: Database,
    private request: Fetcher = fetch,
    private now: () => number = Date.now,
  ) {}
  async get(endpoint: string, params: Record<string, string>): Promise<any> {
    if (!this.key)
      throw new Error(
        "Clé YouTube absente : configurez YOUTUBE_API_KEY côté serveur.",
      );
    // A search-specific daily quota must not disable playlist imports or video metadata.
    const cooldown = this.exhausted.get(endpoint);
    if (cooldown && cooldown.until > this.now()) throw cooldown.error;
    this.exhausted.delete(endpoint);
    if (this.db) {
      // YouTube resets its quota at midnight Pacific time; the budget stops us before it does.
      const budget = Number(process.env["YOUTUBE_DAILY_BUDGET"] ?? 8000);
      const counted = await this.db.orm
        .insert(quotaUsage)
        .values({
          day: sql`(now() AT TIME ZONE 'America/Los_Angeles')::date`,
          units: 1,
        })
        .onConflictDoUpdate({
          target: quotaUsage.day,
          set: { units: sql`${quotaUsage.units} + 1` },
          setWhere: sql`${quotaUsage.units} < ${budget}`,
        })
        .returning({ units: quotaUsage.units });
      if (!counted.length) throw new YouTubeError("daily_quota", 429);
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Header keeps the key out of URL/error logs.
    const response = await this.request(url, {
      headers: { "X-Goog-Api-Key": this.key },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as any;
      const error = youtubeError(response.status, body);
      if (error.kind === "daily_quota")
        this.exhausted.set(endpoint, {
          until: nextYouTubeQuotaReset(this.now()),
          error,
        });
      throw error;
    }
    return response.json();
  }
  async search(query: string, pageToken = "") {
    const data = await this.get("search", {
      part: "snippet",
      type: "video",
      videoCategoryId: "10",
      q: query,
      maxResults: "15",
      videoEmbeddable: "true",
      videoSyndicated: "true",
      order: "relevance",
      ...(pageToken ? { pageToken } : {}),
    });
    const ids: string[] = [
      ...new Set<string>(
        (data.items ?? [])
          .map((row: any) => row.id?.videoId)
          .filter(
            (id: unknown) => typeof id === "string" && /^[\w-]{11}$/.test(id),
          ),
      ),
    ];
    const videos = await this.videos(ids);
    const byId = new Map(videos.map((video) => [video.id, video]));
    return {
      videos: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      nextPageToken:
        typeof data.nextPageToken === "string" ? data.nextPageToken : null,
    };
  }
  async playlist(
    id: string,
  ): Promise<{ title: string; entries: PlaylistEntry[] }> {
    const info = await this.get("playlists", { part: "snippet", id });
    if (!info.items?.length)
      throw new Error("Playlist absente ou inaccessible.");
    const entries: PlaylistEntry[] = [];
    const seen = new Set<string>();
    let page = "";
    const pages = new Set<string>();
    do {
      if (pages.has(page)) throw new Error("Pagination YouTube incohérente.");
      pages.add(page);
      const data = await this.get("playlistItems", {
        part: "snippet,contentDetails",
        playlistId: id,
        maxResults: "50",
        ...(page ? { pageToken: page } : {}),
      });
      if (!Array.isArray(data.items))
        throw new Error("Réponse playlist YouTube invalide.");
      for (const row of data.items) {
        const videoId =
          row.contentDetails?.videoId ?? row.snippet?.resourceId?.videoId;
        if (!/^[\w-]{11}$/.test(videoId ?? "") || !row.id || seen.has(row.id))
          throw new Error("Entrée YouTube invalide ou répétée.");
        seen.add(row.id);
        entries.push({
          key: row.id,
          videoId,
          position: Number(row.snippet.position) + 1,
          addedAt: row.snippet.publishedAt ?? null,
          title:
            row.snippet.title &&
            !["Private video", "Deleted video"].includes(row.snippet.title)
              ? row.snippet.title
              : null,
          channel: row.snippet.videoOwnerChannelTitle ?? null,
        });
      }
      page = data.nextPageToken ?? "";
      if (entries.length > 50000)
        throw new Error("Limite de 50 000 entrées atteinte.");
    } while (page);
    return { title: info.items[0].snippet.title, entries };
  }
  async videos(
    ids: string[],
    playableOnly = false,
    musicOnly = false,
  ): Promise<(Video & { channelId: string | null })[]> {
    if (!ids.length) return [];
    if (ids.length > 50) throw new Error("Maximum 50 vidéos par lot.");
    const data = await this.get("videos", {
      part: "snippet,contentDetails,status",
      id: ids.join(","),
    });
    return data.items
      .filter(
        (v: any) =>
          (!musicOnly || v.snippet?.categoryId === "10") &&
          (!playableOnly ||
            (v.status?.embeddable === true &&
              v.status?.privacyStatus !== "private" &&
              !["deleted", "failed", "rejected"].includes(
                v.status?.uploadStatus,
              ))),
      )
      .map((v: any) => ({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId ?? null,
        durationSeconds: isoDuration(v.contentDetails.duration),
        description: v.snippet.description ?? "",
        tags: v.snippet.tags ?? [],
        publishedAt: v.snippet.publishedAt ?? null,
        thumbnailUrl:
          v.snippet.thumbnails?.high?.url ??
          `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      }));
  }
  /** Views, likes and comment count of one video, or null when it is gone. One quota unit. */
  async statistics(
    id: string,
  ): Promise<{ views: number | null; likes: number | null; comments: number | null } | null> {
    const data = await this.get("videos", { part: "statistics", id });
    const stats = data.items?.[0]?.statistics;
    if (!stats) return null;
    const count = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null);
    return { views: count(stats.viewCount), likes: count(stats.likeCount), comments: count(stats.commentCount) };
  }
  /**
   * The comments YouTube ranks first, as plain text, one quota unit. Comments turned off
   * answer an empty list, not an error.
   */
  async topComments(
    id: string,
    count = 10,
  ): Promise<{ author: string; text: string; likes: number; publishedAt: string | null }[]> {
    let data: any;
    try {
      data = await this.get("commentThreads", {
        part: "snippet",
        videoId: id,
        order: "relevance",
        textFormat: "plainText",
        maxResults: String(count),
      });
    } catch (error) {
      if (error instanceof YouTubeError && error.kind === "access_denied") return [];
      throw error;
    }
    return (data.items ?? []).flatMap((item: any) => {
      const top = item.snippet?.topLevelComment?.snippet;
      const text = typeof top?.textDisplay === "string" ? top.textDisplay.trim() : "";
      if (!text) return [];
      return [
        {
          author: String(top.authorDisplayName ?? "").replace(/^@/, ""),
          text: text.length > 600 ? text.slice(0, 599).trimEnd() + "…" : text,
          likes: Number(top.likeCount ?? 0),
          publishedAt: top.publishedAt ?? null,
        },
      ];
    });
  }
  /** Channel photos (88 px), at most 50 channels per call and one quota unit. */
  async channelAvatars(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    if (ids.length > 50) throw new Error("Maximum 50 chaînes par lot.");
    const data = await this.get("channels", {
      part: "snippet",
      id: ids.join(","),
    });
    return new Map(
      (data.items ?? [])
        .map((c: any) => [c.id, c.snippet?.thumbnails?.default?.url] as const)
        .filter(
          ([, url]: readonly [string, unknown]) =>
            typeof url === "string" && url.startsWith("https://"),
        ),
    );
  }
}
