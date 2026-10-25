import type { Database } from "./db.ts";
import { isoDuration } from "./content.ts";
import type { Video } from "@playlist-recall/core/types";
export interface PlaylistEntry {
  key: string;
  videoId: string;
  position: number;
  addedAt: string | null;
  title: string | null;
  channel: string | null;
}
type Fetcher = typeof fetch;
export class YouTube {
  constructor(
    private key: string,
    private db?: Database,
    private request: Fetcher = fetch,
  ) {}
  async get(endpoint: string, params: Record<string, string>): Promise<any> {
    if (!this.key)
      throw new Error(
        "Clé YouTube absente : configurez YOUTUBE_API_KEY côté serveur.",
      );
    if (this.db) {
      const { rows } = await this.db.query(
        `INSERT INTO quota_usage(day,units) VALUES((now() AT TIME ZONE 'America/Los_Angeles')::date,1)
        ON CONFLICT(day) DO UPDATE SET units=quota_usage.units+1 WHERE quota_usage.units<$1 RETURNING units`,
        [Number(process.env.YOUTUBE_DAILY_BUDGET ?? 8000)],
      );
      if (!rows.length) throw new Error("Budget YouTube journalier atteint.");
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
      const reason = body.error?.errors?.[0]?.reason;
      throw new Error(
        `YouTube HTTP ${response.status}${typeof reason === "string" ? ` (${reason.replace(/[^a-zA-Z0-9_-]/g, "")})` : ""}`,
      );
    }
    return response.json();
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
  ): Promise<(Video & { channelId: string | null })[]> {
    if (!ids.length) return [];
    if (ids.length > 50) throw new Error("Maximum 50 vidéos par lot.");
    const data = await this.get("videos", {
      part: "snippet,contentDetails,status",
      id: ids.join(","),
    });
    return data.items.map((v: any) => ({
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
