/** One song of YouTube Music's catalog: its video and the artists it credits. */
export interface MusicSong {
  videoId: string;
  title: string;
  artists: string[];
}

/** An artist's page on YouTube Music: its pictures, audience, releases and neighbours. */
export interface MusicArtist {
  browseId: string;
  name: string;
  /** Wide banner (up to 2880 × 1200), or null for artists without one. */
  banner: string | null;
  /** Square portrait from the search row, enlarged. */
  portrait: string | null;
  description: string | null;
  /** As YouTube Music words it, e.g. « 58,2 M auditeurs/mois ». */
  audience: string | null;
  releases: { browseId: string; title: string; kind: string; year: string | null; artwork: string | null }[];
  related: { name: string; portrait: string | null }[];
}

/** YouTube Music's web client and its « Titres » filter: songs only, no videos or mixes. */
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20241028.01.00", hl: "fr" };
const SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const ARTISTS = "EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D";

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
   * The artist of this exact name (accents, case and punctuation aside), or null: a near
   * namesake is worse than no page.
   */
  async artist(name: string): Promise<MusicArtist | null> {
    const found = await this.call("search", { query: name, params: decodeURIComponent(ARTISTS) });
    const row = findArtistRow(found, name);
    if (!row) return null;
    return parseArtistPage(await this.call("browse", { browseId: row.browseId }), row);
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

const texts = (node: any): string =>
  ((node?.runs ?? []) as Run[]).map((run) => run.text ?? "").join("").trim() || (node?.simpleText ?? "");
const pageType = (node: any): string | undefined =>
  node?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
/** The largest of a renderer's thumbnails. */
const picture = (node: any): string | null => {
  const list: { url?: string; width?: number }[] = [];
  find(node, (child) => {
    const thumbnails = (child as { thumbnails?: unknown }).thumbnails;
    if (Array.isArray(thumbnails)) list.push(...thumbnails);
    return undefined;
  });
  const url = list.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
};
/** Google's image links take their size in the URL: ask for a larger square. */
const enlarged = (url: string | null, size = 544) =>
  url?.replace(/=w\d+-h\d+/, `=w${size}-h${size}`) ?? null;

/** Accents, case and punctuation aside: how two artist names are compared. */
export const artistKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** The artist row of a search answer whose name is the one asked. */
export function findArtistRow(body: unknown, name: string) {
  const wanted = artistKey(name);
  let match: { browseId: string; name: string; portrait: string | null } | undefined;
  find(body, (node) => {
    const row = (node as Record<string, any>)["musicResponsiveListItemRenderer"];
    if (!row || match) return undefined;
    const browseId = row.navigationEndpoint?.browseEndpoint?.browseId;
    const title = texts(row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
    if (
      pageType(row) === "MUSIC_PAGE_TYPE_ARTIST" &&
      typeof browseId === "string" &&
      artistKey(title) === wanted &&
      wanted
    )
      match = { browseId, name: title, portrait: enlarged(picture(row.thumbnail)) };
    return match ? true : undefined;
  });
  return match ?? null;
}

/** An artist page: its header, then every release and related artist in its shelves. */
export function parseArtistPage(
  body: unknown,
  row: { browseId: string; name: string; portrait: string | null },
): MusicArtist {
  const header = find(body, (node) => {
    const value = node as Record<string, any>;
    return value["musicImmersiveHeaderRenderer"] ?? value["musicVisualHeaderRenderer"];
  });
  const releases: MusicArtist["releases"] = [];
  const related: MusicArtist["related"] = [];
  find(body, (node) => {
    const item = (node as Record<string, any>)["musicTwoRowItemRenderer"];
    if (!item) return undefined;
    const title = texts(item.title);
    const type = pageType(item);
    if (type === "MUSIC_PAGE_TYPE_ALBUM") {
      const subtitle = texts(item.subtitle);
      const browseId = item.navigationEndpoint?.browseEndpoint?.browseId;
      if (title && typeof browseId === "string" && !releases.some((r) => r.browseId === browseId))
        releases.push({
          browseId,
          title,
          kind: /single|ep\b/i.test(subtitle) ? subtitle.split(" • ")[0]! : "Album",
          year: /\b(19|20)\d\d\b/.exec(subtitle)?.[0] ?? null,
          artwork: enlarged(picture(item.thumbnailRenderer), 400),
        });
    } else if (type === "MUSIC_PAGE_TYPE_ARTIST" && title && artistKey(title) !== artistKey(row.name)) {
      if (!related.some((r) => r.name === title))
        related.push({ name: title, portrait: enlarged(picture(item.thumbnailRenderer), 240) });
    }
    return undefined;
  });
  const audience =
    texts(header?.monthlyListenerCount) ||
    (texts(header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText)
      ? `${texts(header.subscriptionButton.subscribeButtonRenderer.subscriberCountText)} abonnés`
      : "");
  const banner = header ? picture(header.thumbnail) : null;
  return {
    browseId: row.browseId,
    name: texts(header?.title) || row.name,
    // A visual header's picture is the square portrait, not a banner.
    banner: header?.thumbnail && banner && !/=w(\d+)-h\1\b/.test(banner) ? banner : null,
    portrait: row.portrait,
    description: texts(header?.description) || null,
    audience: audience || null,
    releases: releases.slice(0, 12),
    related: related.slice(0, 12),
  };
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
