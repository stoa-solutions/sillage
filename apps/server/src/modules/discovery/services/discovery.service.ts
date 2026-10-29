import type { Database } from "../../../db/index.ts";
import {
  SearxngDiscovery,
  SearxngError,
} from "../../../integrations/searxng/index.ts";
import {
  nextYouTubeQuotaReset,
  YouTube,
  YouTubeError,
} from "../../../integrations/youtube/index.ts";
import { youTubeMusic, type MusicSong } from "../../../integrations/youtube-music/index.ts";
import { normalizeMusic } from "../../search/index.ts";
import { discoveryInput } from "../types/discovery.schemas.ts";
import { searchFailureMessage, type SearchFailureReason } from "../search-feedback.ts";
import { ownedAmong, saveDiscovery } from "../repositories/discovery.repository.ts";

export type DiscoverySource = Pick<YouTube, "search" | "videos">;
function discoverySource(db: Database): DiscoverySource {
  const youtube = new YouTube(process.env["YOUTUBE_API_KEY"] ?? "", db);
  const url = process.env["SEARXNG_URL"]?.trim();
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
    /** Which videos the account already has; recomputed on every request, never cached. */
    readonly owned: (user: string, ids: string[]) => Promise<Set<string>> = (
      user,
      ids,
    ) => ownedAmong(db.orm, user, ids),
    private music: { songs(query: string): Promise<MusicSong[]> } = youTubeMusic,
  ) {}
  private songPages = new Map<string, { until: number; videos: Awaited<ReturnType<YouTube["videos"]>> }>();
  /** Whether an artist's songs are kept, so asking costs nothing. */
  songsCached(artist: string) {
    const hit = this.songPages.get(normalizeMusic(artist));
    return !!hit && hit.until >= Date.now();
  }
  /**
   * An artist's songs, from YouTube Music's catalog (credited to this artist, no mixes or
   * covers), checked and described by the YouTube API. Kept a day: a catalog barely moves.
   */
  async songs(user: string, artist: string) {
    const key = normalizeMusic(artist);
    let page = this.songPages.get(key);
    if (!page || page.until < Date.now()) {
      let found: MusicSong[];
      try {
        found = await this.music.songs(artist);
      } catch (error) {
        throw providerError(error);
      }
      const credited = found
        .filter((song) => song.artists.some((name) => normalizeMusic(name) === key))
        .slice(0, 20);
      let videos: Awaited<ReturnType<YouTube["videos"]>>;
      try {
        videos = await this.source.videos(credited.map((song) => song.videoId), true);
      } catch (error) {
        throw providerError(error);
      }
      // Songs keep YouTube Music's order and credits; a Topic channel names their artist.
      const byId = new Map(videos.map((video) => [video.id, video]));
      page = {
        until: Date.now() + 24 * 60 * 60 * 1000,
        videos: credited.flatMap((song) => {
          const video = byId.get(song.videoId);
          return video
            ? [{ ...video, title: `${song.artists.join(", ")} - ${song.title}` }]
            : [];
        }),
      };
      if (page.videos.length) {
        if (this.songPages.size >= 1000) this.songPages.delete(this.songPages.keys().next().value!);
        this.songPages.set(key, page);
      }
    }
    const owned = await this.owned(user, page.videos.map((video) => video.id));
    return {
      results: page.videos.map((video) => ({ video, inLibrary: owned.has(video.id) })),
      nextPageToken: null,
    };
  }
  /** Whether this first page is kept, so a search would cost nothing. */
  cached(query: string) {
    const hit = this.cache.get(JSON.stringify([query.trim().toLowerCase(), ""]));
    return !!hit && hit.until >= Date.now();
  }
  /** `keep` is how long a public page stays cached; « Pour toi » keeps an artist's a day. */
  async search(user: string, query: string, pageToken = "", keep = 300000) {
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
        result = { until: Date.now() + keep, result: data };
        // An empty page is often the search engine throttling a burst: never kept.
        if (data.videos.length) {
          if (this.cache.size >= 500)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, result);
        }
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
    const playlistId = await saveDiscovery(this.db.orm, user, video);
    return { saved: true as const, playlistId, video };
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
