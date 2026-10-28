/** One song of YouTube Music's catalog: its video and the artists it credits. */
export interface MusicSong {
  videoId: string;
  title: string;
  artists: string[];
}

/** YouTube Music's web client and its « Titres » filter: songs only, no videos or mixes. */
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20241028.01.00", hl: "fr" };
const SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

type Run = {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
  };
};

/**
 * Songs by name on YouTube Music, as its own web client asks them: keyless, structured artist
 * credits, official songs first. Only the search; videos are then checked by the YouTube API.
 */
export class YouTubeMusic {
  /** Without a fetcher, the global one at call time. */
  constructor(private fetcher?: typeof fetch) {}

  private async call(path: string, body: object): Promise<unknown> {
    const response = await (this.fetcher ?? fetch)(
      `https://music.youtube.com/youtubei/v1/${path}?prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://music.youtube.com",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sillage/2.2",
        },
        body: JSON.stringify({ context: { client: CLIENT }, ...body }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`YouTube Music indisponible (HTTP ${response.status}).`);
    return response.json();
  }

  async songs(query: string): Promise<MusicSong[]> {
    return parseSongs(await this.call("search", { query, params: decodeURIComponent(SONGS) }));
  }

  /**
   * The lyrics YouTube Music shows for a video (plain text, licensed from the provider it
   * names, e.g. Musixmatch), or null when it shows none.
   */
  async lyrics(videoId: string): Promise<{ text: string; provider: string | null } | null> {
    const next = await this.call("next", { videoId });
    const browseId = find(next, (node) => {
      const id = (node as { browseEndpoint?: { browseId?: unknown } }).browseEndpoint?.browseId;
      return typeof id === "string" && id.startsWith("MPLY") ? id : undefined;
    });
    if (!browseId) return null;
    const page = await this.call("browse", { browseId });
    const shelf = find(page, (node) => (node as Record<string, any>)["musicDescriptionShelfRenderer"]);
    const text = (shelf?.description?.runs ?? []).map((run: Run) => run.text ?? "").join("").trim();
    if (!text) return null;
    const footer = (shelf?.footer?.runs ?? []).map((run: Run) => run.text ?? "").join("");
    return { text, provider: /:\s*(.+)$/.exec(footer)?.[1]?.trim() ?? null };
  }
}

/** The first value `pick` returns while walking an answer, depth first. */
function find<T>(node: unknown, pick: (node: object) => T | undefined): T | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, pick);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const here = pick(node);
  if (here !== undefined) return here;
  for (const child of Object.values(node)) {
    const found = find(child, pick);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The song rows of a search answer, whatever shelves surround them. */
export function parseSongs(body: unknown): MusicSong[] {
  const songs: MusicSong[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const row = (node as Record<string, any>)["musicResponsiveListItemRenderer"];
    if (row) {
      const videoId: unknown =
        row.playlistItemData?.videoId ??
        row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchEndpoint?.videoId;
      const columns = (row.flexColumns ?? []).map(
        (column: any): Run[] => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [],
      );
      const title = (columns[0] ?? []).map((run: Run) => run.text ?? "").join("").trim();
      const details: Run[] = columns[1] ?? [];
      let artists = details
        .filter(
          (run) =>
            run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
              ?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ARTIST",
        )
        .map((run) => run.text?.trim() ?? "")
        .filter(Boolean);
      // Without links, the credits are the text before the first « • ».
      if (!artists.length)
        artists = (details.map((run) => run.text ?? "").join("").split(" • ")[0] ?? "")
          .split(/,\s*|\s+(?:et|&|and|x)\s+/i)
          .map((name) => name.trim())
          .filter(Boolean);
      if (typeof videoId === "string" && /^[\w-]{11}$/.test(videoId) && title && !seen.has(videoId)) {
        seen.add(videoId);
        songs.push({ videoId, title, artists });
      }
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(body);
  return songs;
}

export const youTubeMusic = new YouTubeMusic();
