import type { SimilarArtist } from "../../integrations/listenbrainz/index.ts";
import { normalizeMusic } from "../search/index.ts";
import { artistName } from "../taste/index.ts";
import type { Discovery } from "./discovery.service.ts";
import type { HistoryRow, KnownVideo } from "./discovery.repository.ts";

export interface DiscoverySeed {
  query: string;
  reason: string;
  kind: "artist" | "genre";
}

/** How much « Pour toi » proposes; every number of the page lives here. */
export const HOME_RULES = {
  /** Favourite artists whose listening neighbours are explored. */
  tasteSeeds: 5,
  /** Recently heard artists added to them, for what the listener is into right now. */
  recentSeeds: 2,
  /** New artists kept per seed, among its closest unknown neighbours. */
  neighboursPerSeed: 3,
  /** A refresh draws them from this many closest neighbours instead. */
  neighbourPool: 8,
  tracksPerArtist: 2,
  genreSections: 2,
  tracksPerGenre: 6,
  ownArtistTracks: 6,
  /** Searches running at once: the catalog source accepts four. */
  concurrency: 3,
  ideas: 8,
} as const;

/** What the server knows of a listener before proposing anything. */
export interface ListenerProfile {
  /** Favourite artists first (taste ranking), with their MusicBrainz ID when known. */
  artists: { name: string; mbid?: string | undefined }[];
  knownNames: Set<string>;
  knownMbids: Set<string>;
  /** Genres of the library weighted by plays, most present first. */
  genres: string[];
}

export interface HomeSources {
  history(user: string): Promise<HistoryRow[]>;
  profile(user: string): Promise<ListenerProfile>;
  similar(mbid: string): Promise<SimilarArtist[]>;
  search: Discovery["search"];
}

type SearchItem = Awaited<ReturnType<Discovery["search"]>>["results"][number];
export interface HomeItem extends SearchItem {
  reason: string;
  artist?: string | undefined;
}
export interface HomeSection {
  id: string;
  kind: "neighbours" | "genre" | "artists";
  title: string;
  reason: string;
  items: HomeItem[];
}

const titleKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const nameKey = (value: string) => normalizeMusic(value).trim();
const JUNK = /\b(type beat|backing track|tutorial|audiobook|podcast|for drummers?|bpm|reaction|karaoke|cover|lyrics? video)\b/i;

/** The listener's artists and genres, from their library, their plays and their taste ranking. */
export function listenerProfile(
  videos: KnownVideo[],
  favourites: { name: string }[],
): ListenerProfile {
  const knownNames = new Set<string>();
  const knownMbids = new Set<string>();
  const mbidByName = new Map<string, string>();
  const genres = new Map<string, { name: string; weight: number }>();
  for (const video of videos) {
    const name = artistName(video);
    if (name) knownNames.add(nameKey(name));
    const metadata = video.musicMetadata?.status === "matched" ? video.musicMetadata : undefined;
    for (const artist of metadata?.artists ?? []) {
      knownNames.add(nameKey(artist.name));
      knownMbids.add(artist.id);
      if (!mbidByName.has(nameKey(artist.name))) mbidByName.set(nameKey(artist.name), artist.id);
    }
    const tags = metadata?.genres?.length ? metadata.genres : (metadata?.artistGenres ?? []);
    for (const genre of tags.slice(0, 3)) {
      const key = genre.toLowerCase();
      const entry = genres.get(key) ?? { name: genre, weight: 0 };
      entry.weight += 1 + video.plays;
      genres.set(key, entry);
    }
  }
  return {
    artists: favourites.map(({ name }) => ({ name, mbid: mbidByName.get(nameKey(name)) })),
    knownNames,
    knownMbids,
    genres: [...genres.values()].sort((a, b) => b.weight - a.weight).map((genre) => genre.name),
  };
}

/** Recent positive plays, as artist and genre seeds (the « de tes artistes » shelf). */
export function discoverySeeds(history: HistoryRow[]): DiscoverySeed[] {
  const seeds: DiscoverySeed[] = [];
  const seen = new Set<string>();
  const add = (query: string | undefined, reason: string, kind: DiscoverySeed["kind"]) => {
    query = query
      ?.replace(/\s*[-–]\s*Topic$/i, "")
      .trim()
      .slice(0, 120);
    if (!query || query.length < 2 || seen.has(query.toLowerCase())) return;
    seen.add(query.toLowerCase());
    seeds.push({ query, reason, kind });
  };
  for (const row of history
    .filter((row) => ["finished", "replaced"].includes(row.outcome))
    .slice(0, 20)) {
    const metadata = row.music_metadata?.status === "matched" ? row.music_metadata : undefined;
    const artist =
      metadata?.artists?.[0]?.name ?? row.channel?.replace(/\s*[-–]\s*Topic$/i, "") ?? undefined;
    const genres = metadata?.genres?.length ? metadata.genres : metadata?.artistGenres;
    if (genres?.[0])
      add(genres[0], `Pour explorer ${genres[0]}, autour de tes écoutes récentes`, "genre");
    add(artist, `Parce que tu as écouté ${artist ?? row.title}`, "artist");
    if (seeds.length >= 3) break;
  }
  return seeds.slice(0, 3);
}

/** An artist name in a song title is not an artist credit (e.g. a song called The Alchemist). */
function byArtist(artist: string, title: string, channel: string) {
  const name = normalizeMusic(artist);
  const contains = (value: string) => (" " + normalizeMusic(value) + " ").includes(" " + name + " ");
  if (contains(channel)) return true;
  const credit = title.split(/\s+[-–—]\s+/)[0] ?? title;
  if (contains(credit)) return true;
  return ["feat ", "ft ", "featuring ", "avec "].some((marker) =>
    normalizeMusic(title).includes(marker + name),
  );
}

/** Runs the tasks a few at a time, in order; a failed task yields undefined. */
async function limited<T>(tasks: (() => Promise<T>)[], concurrency: number) {
  const results: (T | undefined)[] = new Array(tasks.length);
  let next = 0;
  let failures = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        try {
          results[index] = await tasks[index]!();
        } catch {
          failures++;
        }
      }
    }),
  );
  return { results, failures };
}

/**
 * « Pour toi »: artists the listener does not know yet, near the ones they love (ListenBrainz
 * listening neighbours, excluding every artist of their library and plays), then their own
 * genres without their own artists, then new tracks of their recent artists. Nothing is cached
 * per account here; `rotate` draws other neighbours for a refresh.
 */
export async function discoveryHome(
  sources: HomeSources,
  user: string,
  { rotate = false, random = Math.random }: { rotate?: boolean; random?: () => number } = {},
) {
  const [history, profile] = await Promise.all([sources.history(user), sources.profile(user)]);
  const recent = discoverySeeds(history);
  const heard = new Set(history.map((row) => row.video_id));
  const titles = new Set(history.map((row) => titleKey(row.title)));
  const used = new Set<string>();
  const usable = (item: SearchItem) =>
    !item.inLibrary &&
    !!item.video.title &&
    !heard.has(item.video.id) &&
    !used.has(item.video.id) &&
    !titles.has(titleKey(item.video.title)) &&
    !JUNK.test(item.video.title);
  const take = (item: SearchItem, reason: string, artist?: string): HomeItem => {
    used.add(item.video.id);
    titles.add(titleKey(item.video.title ?? ""));
    return { ...item, reason, ...(artist ? { artist } : {}) };
  };

  // Seeds: favourite artists with a MusicBrainz ID, then recently heard ones.
  const seeds: { name: string; mbid: string }[] = [];
  const seedNames = new Set<string>();
  const addSeed = (name: string, mbid: string | undefined) => {
    if (!mbid || seedNames.has(nameKey(name))) return;
    seedNames.add(nameKey(name));
    seeds.push({ name, mbid });
  };
  for (const artist of profile.artists) {
    if (seeds.length >= HOME_RULES.tasteSeeds) break;
    addSeed(artist.name, artist.mbid);
  }
  const recentArtists = recent.filter((seed) => seed.kind === "artist");
  for (const seed of recentArtists.slice(0, HOME_RULES.recentSeeds)) {
    const mbid = profile.artists.find((artist) => nameKey(artist.name) === nameKey(seed.query))?.mbid;
    addSeed(seed.query, mbid);
  }

  const neighbourLists = await limited(
    seeds.map((seed) => () => sources.similar(seed.mbid)),
    HOME_RULES.concurrency,
  );
  const chosen = new Set<string>();
  const plans = seeds.map((seed, index) => {
    const unknown = (neighbourLists.results[index] ?? []).filter(
      (artist) =>
        !profile.knownMbids.has(artist.mbid) &&
        !profile.knownNames.has(nameKey(artist.name)) &&
        !seedNames.has(nameKey(artist.name)) &&
        !chosen.has(artist.mbid),
    );
    const pool = unknown.slice(0, rotate ? HOME_RULES.neighbourPool : HOME_RULES.neighboursPerSeed);
    if (rotate)
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
    const picked = pool.slice(0, HOME_RULES.neighboursPerSeed);
    for (const artist of picked) chosen.add(artist.mbid);
    return { seed, picked };
  });

  const neighbourSearches = plans.flatMap(({ seed, picked }) =>
    picked.map((artist) => ({ seed, artist })),
  );
  const genres = profile.genres.slice(0, HOME_RULES.genreSections);
  const ownArtists = recentArtists.slice(0, 2);
  const searches = await limited(
    [
      ...neighbourSearches.map(({ artist }) => () => sources.search(user, artist.name)),
      ...genres.map((genre) => () => sources.search(user, genre + " music")),
      ...ownArtists.map((seed) => () => sources.search(user, seed.query + " official music")),
    ],
    HOME_RULES.concurrency,
  );

  const sections: HomeSection[] = [];
  plans.forEach(({ seed, picked }) => {
    const items: HomeItem[] = [];
    for (const artist of picked) {
      const at = neighbourSearches.findIndex((entry) => entry.artist === artist);
      const results = searches.results[at]?.results ?? [];
      results
        .filter((item) => usable(item) && byArtist(artist.name, item.video.title ?? "", item.video.channel ?? ""))
        .slice(0, HOME_RULES.tracksPerArtist)
        .forEach((item) => items.push(take(item, `${artist.name}, proche de ${seed.name}`, artist.name)));
    }
    if (items.length)
      sections.push({
        id: `neighbours:${seed.mbid}`,
        kind: "neighbours",
        title: `Autour de ${seed.name}`,
        reason: `Des artistes que tu n’as pas encore, écoutés par les mêmes personnes que ${seed.name}`,
        items,
      });
  });
  genres.forEach((genre, index) => {
    const results = searches.results[neighbourSearches.length + index]?.results ?? [];
    const items = results
      .filter((item) => {
        const name = artistName(item.video);
        return usable(item) && (!name || !profile.knownNames.has(nameKey(name)));
      })
      .slice(0, HOME_RULES.tracksPerGenre)
      .map((item) => take(item, `Du ${genre}, par des artistes que tu n’as pas`, artistName(item.video)));
    if (items.length)
      sections.push({
        id: `genre:${genre.toLowerCase()}`,
        kind: "genre",
        title: `Côté ${genre}`,
        reason: `Un genre très présent dans ta bibliothèque, sans tes artistes habituels`,
        items,
      });
  });
  const own: HomeItem[] = [];
  ownArtists.forEach((seed, index) => {
    const results =
      searches.results[neighbourSearches.length + genres.length + index]?.results ?? [];
    results
      .filter((item) => usable(item) && byArtist(seed.query, item.video.title ?? "", item.video.channel ?? ""))
      .slice(0, HOME_RULES.ownArtistTracks / 2)
      .forEach((item) => own.push(take(item, seed.reason, seed.query)));
  });
  if (own.length)
    sections.push({
      id: "artists",
      kind: "artists",
      title: "De tes artistes, pas encore chez toi",
      reason: "D’autres titres des artistes que tu écoutes en ce moment",
      items: own,
    });

  const suggestions = sections.flatMap((section) => section.items);
  const failed = searches.failures + neighbourLists.failures;
  return {
    sections,
    suggestions,
    basedOn: [
      ...new Set([...seeds.map((seed) => seed.name), ...ownArtists.map((seed) => seed.query), ...genres]),
    ],
    ideas: profile.genres.slice(0, HOME_RULES.ideas),
    notice: failed
      ? "Une recherche n’a pas abouti. Les découvertes disponibles restent affichées."
      : null,
    emptyReason:
      !profile.artists.length && !recent.length
        ? "Écoute quelques morceaux pour recevoir des découvertes selon tes goûts."
        : !suggestions.length
          ? "Aucune nouvelle découverte cette fois. Actualise ou explore une envie."
          : null,
  };
}
