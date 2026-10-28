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
  /** Artists tried as starting points, favourites then the most played: niche ones often
   * have no neighbours. */
  tasteSeeds: 30,
  /** Recently heard artists, placed after the three favourites. */
  recentSeeds: 2,
  /** Shelves of new artists at most (« Autour de X », « Avec X », « Scène … »). */
  neighbourSections: 6,
  /** New artists kept per shelf, among the closest unknown neighbours. */
  neighboursPerSeed: 2,
  /** A refresh draws them from this many closest neighbours instead. */
  neighbourPool: 10,
  /** One search per artist: three of its songs cost nothing more. */
  tracksPerArtist: 3,
  /** « Plus loin »: neighbours of the first new artists found. */
  furtherArtists: 3,
  /** Searches not already kept, per page: YouTube throttles a burst for minutes. */
  freshSearches: 10,
  /** Searches running at once: the catalog source accepts four, YouTube throttles bursts. */
  concurrency: 2,
  ideas: 8,
  /** Scenes and starting artists offered in the sidebar. */
  scenes: 10,
  exploreArtists: 12,
  /** A scene page: new artists of the genre. */
  sceneArtists: 6,
  /** An artist page: their songs, neighbours and collaborators. */
  artistSongs: 6,
  artistNeighbours: 4,
  artistCollaborators: 3,
} as const;

/** What the server knows of a listener before proposing anything. */
export interface ListenerProfile {
  /** Favourite artists first (taste ranking), then the most played ones, with their
   * MusicBrainz ID when known. */
  artists: { name: string; mbid?: string | undefined; genres?: string[] | undefined }[];
  knownNames: Set<string>;
  knownMbids: Set<string>;
  /** Genres of the library weighted by plays, most present first. */
  genres: string[];
}

export interface HomeSources {
  history(user: string): Promise<HistoryRow[]>;
  profile(user: string): Promise<ListenerProfile>;
  similar(mbid: string): Promise<SimilarArtist[]>;
  /** The MusicBrainz ID of an artist known only by name, when it is unambiguous. */
  artistId(name: string): Promise<string | undefined>;
  /** Artists credited on the same recordings (MusicBrainz), most frequent first. */
  collaborators(mbid: string): Promise<SimilarArtist[]>;
  /** Artists MusicBrainz files under this genre. */
  tagged(genre: string): Promise<SimilarArtist[]>;
  /** An artist's songs (YouTube Music, checked by YouTube). */
  search: Discovery["songs"];
  /** Whether an artist's songs are already kept, so free. */
  cached(artist: string): boolean;
}

type SearchItem = Awaited<ReturnType<Discovery["songs"]>>["results"][number];
export interface HomeItem extends SearchItem {
  reason: string;
  artist?: string | undefined;
}
export interface HomeSection {
  id: string;
  kind: "neighbours" | "collaborations" | "scene" | "artists";
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
/** Mixes and compilations: a discovery is one artist's song. */
const MIX = /\b(mix|mixtape|compilation|playlist|best of|greatest hits|full album|non-?stop|\d+\s*hours?)\b/i;
const LONGEST_SONG = 15 * 60;
/** Lives and sessions come after the studio version of the same artist. */
const LIVE = /\b(live|tiny desk|kexp|sofar|colors show|session|concert|performance|unplugged|acoustic)\b/i;

/** The listener's artists and genres, from their library, their plays and their taste ranking. */
export function listenerProfile(
  videos: KnownVideo[],
  favourites: { name: string }[],
): ListenerProfile {
  const knownNames = new Set<string>();
  const knownMbids = new Set<string>();
  const mbidByName = new Map<string, string>();
  const genresByName = new Map<string, string[]>();
  const genres = new Map<string, { name: string; weight: number }>();
  const played = new Map<string, { name: string; plays: number }>();
  for (const video of videos) {
    const name = artistName(video);
    if (name) {
      knownNames.add(nameKey(name));
      const entry = played.get(nameKey(name)) ?? { name, plays: 0 };
      entry.plays += video.plays;
      played.set(nameKey(name), entry);
    }
    const metadata = video.musicMetadata?.status === "matched" ? video.musicMetadata : undefined;
    for (const artist of metadata?.artists ?? []) {
      knownNames.add(nameKey(artist.name));
      knownMbids.add(artist.id);
      if (!mbidByName.has(nameKey(artist.name))) mbidByName.set(nameKey(artist.name), artist.id);
    }
    const primary = metadata?.artists?.[0]?.name;
    if (primary && metadata?.artistGenres?.length && !genresByName.has(nameKey(primary)))
      genresByName.set(nameKey(primary), metadata.artistGenres);
    const tags = metadata?.genres?.length ? metadata.genres : (metadata?.artistGenres ?? []);
    for (const genre of tags.slice(0, 3)) {
      const key = genre.toLowerCase();
      const entry = genres.get(key) ?? { name: genre, weight: 0 };
      entry.weight += 1 + video.plays;
      genres.set(key, entry);
    }
  }
  const listened = [...played.values()]
    .filter((artist) => artist.plays > 0)
    .sort((a, b) => b.plays - a.plays);
  const names = [...new Map([...favourites, ...listened].map(({ name }) => [nameKey(name), name])).values()];
  return {
    artists: names.map((name) => ({
      name,
      mbid: mbidByName.get(nameKey(name)),
      genres: genresByName.get(nameKey(name)),
    })),
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
    const artist = artistName({ title: row.title, channel: row.channel, musicMetadata: metadata });
    const genres = metadata?.genres?.length ? metadata.genres : metadata?.artistGenres;
    if (genres?.[0])
      add(genres[0], `Pour explorer ${genres[0]}, autour de tes écoutes récentes`, "genre");
    add(artist, `Parce que tu as écouté ${artist ?? row.title}`, "artist");
    if (seeds.length >= 3) break;
  }
  return seeds.slice(0, 3);
}

/**
 * An artist name in a song title is not an artist credit (a song called The Alchemist, a
 * Young Thug song called Phoenix): the credit is a « X - Topic » channel, the artist's own
 * channel, or the part of the title before « - », « | » or « : ».
 */
function byArtist(artist: string, title: string, channel: string) {
  const name = normalizeMusic(artist);
  const contains = (value: string) => (" " + normalizeMusic(value) + " ").includes(" " + name + " ");
  const topic = /^(.*?)\s*-\s*Topic$/i.exec(channel)?.[1];
  if (topic !== undefined) return contains(topic);
  if (contains(channel.replace(/VEVO$/i, ""))) return true;
  const parts = title.split(/\s+(?:[-–—|]|\/\/)\s+|:\s+/);
  if (parts.length > 1 && contains(parts[0]!)) return true;
  return ["feat ", "ft ", "featuring ", "avec "].some((marker) =>
    normalizeMusic(title).includes(marker + name),
  );
}

/** Genres too wide to make a scene: they bring the hits of the genre, not neighbours. */
const BROAD = new Set(
  "pop rock hip hop rap electronic latin reggaeton r&b rnb soul jazz dance indie alternative folk world metal funk blues classical country electronic dance music"
    .split(" ")
    .concat(["hip hop", "r&b", "electronic dance music", "alternative rock", "indie pop", "pop rap"]),
);
/** The most precise genre of an artist (« digital cumbia » rather than « cumbia »). */
export function sceneOf(genres: string[] = []) {
  return genres
    .filter((genre) => !BROAD.has(genre.toLowerCase()))
    .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)[0];
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

interface Plan {
  seed: { name: string; mbid: string };
  shelf: Omit<HomeSection, "items">;
  /** Why one of its artists is proposed. */
  why: (artist: string) => string;
  /** Artists shown, then spares tried when one has no usable track. */
  want: number;
  pool: SimilarArtist[];
  found: { artist: SimilarArtist; items: SearchItem[] }[];
}
type Candidate = ListenerProfile["artists"][number];

/**
 * What every Découvrir page shares: the listener, what they already know, and the YouTube
 * search budget. YouTube throttles a burst for minutes, for the DJ and the search too: a page
 * makes a few fresh searches, an artist page already kept costs nothing, and two empty answers
 * in a row stop the fresh ones.
 */
async function explorer(
  sources: HomeSources,
  user: string,
  { rotate = false, random = Math.random }: { rotate?: boolean; random?: () => number },
) {
  const [history, profile] = await Promise.all([sources.history(user), sources.profile(user)]);
  const heard = new Set(history.map((row) => row.video_id));
  const titles = new Set(history.map((row) => titleKey(row.title)));
  const used = new Set<string>();
  const seedNames = new Set<string>();
  const chosen = new Set<string>();
  let failures = 0;
  const usable = (item: SearchItem) =>
    !item.inLibrary &&
    !!item.video.title &&
    !heard.has(item.video.id) &&
    !used.has(item.video.id) &&
    !titles.has(titleKey(item.video.title)) &&
    !JUNK.test(item.video.title) &&
    !MIX.test(item.video.title) &&
    (item.video.durationSeconds ?? 0) <= LONGEST_SONG;
  const take = (item: SearchItem, reason: string, artist?: string): HomeItem => {
    used.add(item.video.id);
    titles.add(titleKey(item.video.title ?? ""));
    return { ...item, reason, ...(artist ? { artist } : {}) };
  };
  /** The song of an « Artist - Song | Channel » title, to keep one version of each. */
  const songKey = (title: string) => titleKey(title.split(/\s+[-–—]\s+/)[1]?.split(/\s+\|\s+/)[0] ?? title);
  const tracksOf = (artist: string, results: SearchItem[] | undefined, count: number = HOME_RULES.tracksPerArtist) => {
    const songs = new Set<string>();
    return (results ?? [])
      .filter((item) => usable(item) && byArtist(artist, item.video.title ?? "", item.video.channel ?? ""))
      .sort((a, b) => Number(LIVE.test(a.video.title ?? "")) - Number(LIVE.test(b.video.title ?? "")))
      .filter((item) => {
        const key = songKey(item.video.title ?? "");
        if (songs.has(key)) return false;
        songs.add(key);
        return true;
      })
      .slice(0, count);
  };
  const unknown = (artist: SimilarArtist) =>
    !profile.knownMbids.has(artist.mbid) &&
    !profile.knownNames.has(nameKey(artist.name)) &&
    !seedNames.has(nameKey(artist.name)) &&
    !chosen.has(artist.mbid);
  let fresh = 0;
  let empties = 0;
  const find = async (query: string) => {
    if (sources.cached(query)) return sources.search(user, query);
    if (fresh >= HOME_RULES.freshSearches || empties >= 2) return undefined;
    fresh++;
    const page = await sources.search(user, query);
    empties = page.results.length ? 0 : empties + 1;
    return page;
  };
  const run = async <T>(tasks: (() => Promise<T>)[]) => {
    const done = await limited(tasks, HOME_RULES.concurrency);
    failures += done.failures;
    return done.results;
  };

  /** A shelf of new artists, when some of these are unknown to the listener. */
  const plan = (
    seed: Plan["seed"],
    artists: SimilarArtist[],
    shelf: Plan["shelf"],
    why: Plan["why"],
    want: number = HOME_RULES.neighboursPerSeed,
  ): Plan | undefined => {
    const pool = artists.filter(unknown).slice(0, rotate ? Math.max(HOME_RULES.neighbourPool, want * 2) : want * 2);
    if (!pool.length) return undefined;
    if (rotate)
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
    const kept = pool.slice(0, want * 2);
    kept.forEach((artist) => chosen.add(artist.mbid));
    return { seed, shelf, why, want, pool: kept, found: [] };
  };

  /** Neighbours first; for an artist too confidential for them, the artists it recorded with,
   * then its scene: real links from ListenBrainz and MusicBrainz, never a guess. */
  const around = async (candidate: Candidate, scenes: Set<string>) => {
    const mbid = candidate.mbid ?? (await sources.artistId(candidate.name));
    if (!mbid) return undefined;
    const seed = { name: candidate.name, mbid };
    const name = seed.name;
    const neighbours = await sources.similar(mbid);
    if (neighbours.some(unknown))
      return { seed, artists: neighbours, ...neighbourShelf(name, mbid) };
    const together = await sources.collaborators(mbid);
    if (together.some(unknown))
      return { seed, artists: together, ...collaborationShelf(name, mbid) };
    const genre = sceneOf(candidate.genres);
    if (!genre || scenes.has(genre.toLowerCase())) return undefined;
    scenes.add(genre.toLowerCase());
    const scene = await sources.tagged(genre);
    return scene.some(unknown) ? { seed, artists: scene, ...sceneShelf(genre, name) } : undefined;
  };

  /** Finds the tracks of each shelf (one artist per shelf first), replaces artists without a
   * usable track, and goes one step further from the first new artists. */
  const fill = async (plans: Plan[], { further = true } = {}) => {
    const most = Math.max(0, ...plans.map((plan) => plan.want));
    const first = Array.from({ length: most }, (_, rank) =>
      plans.flatMap((plan) => (rank < plan.want && plan.pool[rank] ? [{ plan, artist: plan.pool[rank] }] : [])),
    ).flat();
    const firstPages = await run(first.map(({ artist }) => () => find(artist.name)));
    first.forEach(({ plan, artist }, index) => {
      const items = tracksOf(artist.name, firstPages[index]?.results);
      if (items.length) plan.found.push({ artist, items });
    });
    const second = plans.flatMap((plan) =>
      plan.pool
        .slice(plan.want)
        .slice(0, plan.want - plan.found.length)
        .map((artist) => ({ plan, artist })),
    );
    const steps = further
      ? plans
          .filter((plan) => plan.found.length)
          .slice(0, HOME_RULES.furtherArtists)
          .map((plan) => ({ seed: plan.seed, via: plan.found[0]!.artist }))
      : [];
    const furtherLists = await run(steps.map((step) => () => sources.similar(step.via.mbid)));
    const next = steps.flatMap((step, index) => {
      const artist = (furtherLists[index] ?? []).find(unknown);
      if (!artist) return [];
      chosen.add(artist.mbid);
      return [{ ...step, artist }];
    });
    const secondPages = await run([...second, ...next].map(({ artist }) => () => find(artist.name)));
    second.forEach(({ plan, artist }, index) => {
      const items = tracksOf(artist.name, secondPages[index]?.results);
      if (items.length) plan.found.push({ artist, items });
    });
    const sections: HomeSection[] = [];
    for (const { shelf, why, found, pool } of plans) {
      found.sort((a, b) => pool.indexOf(a.artist) - pool.indexOf(b.artist));
      const items = found.flatMap(({ artist, items }) =>
        items.map((item) => take(item, why(artist.name), artist.name)),
      );
      if (items.length) sections.push({ ...shelf, items });
    }
    const far = next.flatMap(({ seed, via, artist }, index) =>
      tracksOf(artist.name, secondPages[second.length + index]?.results).map((item) =>
        take(item, `${artist.name}, proche de ${via.name}, découvert grâce à ${seed.name}`, artist.name),
      ),
    );
    if (far.length)
      sections.push({
        id: "further",
        kind: "neighbours",
        title: "Plus loin",
        reason: "Un pas de plus : les voisins de tes nouvelles découvertes",
        items: far,
      });
    return sections;
  };

  /** What the page answers, with the listener's scenes and artists to explore next. */
  const page = (sections: HomeSection[], basedOn: string[], emptyReason: string | null) => {
    const suggestions = sections.flatMap((section) => section.items);
    return {
      sections,
      suggestions,
      basedOn,
      ideas: profile.genres.slice(0, HOME_RULES.ideas),
      scenes: listenerScenes(profile),
      artists: profile.artists.slice(0, HOME_RULES.exploreArtists).map((artist) => artist.name),
      notice: failures
        ? "Une recherche n’a pas abouti. Les découvertes disponibles restent affichées."
        : null,
      emptyReason: suggestions.length ? null : emptyReason,
    };
  };

  return { history, profile, seedNames, unknown, tracksOf, take, find, run, plan, around, fill, page };
}

const neighbourShelf = (name: string, mbid: string) => ({
  shelf: {
    id: `neighbours:${mbid}`,
    kind: "neighbours" as const,
    title: `Autour de ${name}`,
    reason: `Des artistes que tu n’as pas encore, écoutés par les mêmes personnes que ${name}`,
  },
  why: (artist: string) => `${artist}, proche de ${name}`,
});
const collaborationShelf = (name: string, mbid: string) => ({
  shelf: {
    id: `collaborations:${mbid}`,
    kind: "collaborations" as const,
    title: `Avec ${name}`,
    reason: `Des artistes qui ont enregistré avec ${name}, d’après MusicBrainz`,
  },
  why: (artist: string) => `${artist} a enregistré avec ${name}`,
});
const sceneShelf = (genre: string, name?: string) => ({
  shelf: {
    id: `scene:${genre.toLowerCase()}`,
    kind: "scene" as const,
    title: `Scène ${genre}`,
    reason: name
      ? `D’autres artistes ${genre}, comme ${name}, d’après MusicBrainz`
      : `Des artistes ${genre} que tu n’as pas encore, d’après MusicBrainz`,
  },
  why: (artist: string) => (name ? `${artist}, ${genre} comme ${name}` : `${artist}, ${genre}`),
});

/** The listener's precise genres, most listened first: the scenes they can explore. */
export function listenerScenes(profile: ListenerProfile) {
  return profile.genres.filter((genre) => !BROAD.has(genre.toLowerCase())).slice(0, HOME_RULES.scenes);
}

/**
 * « Pour toi »: artists the listener does not know yet, near the ones they love (ListenBrainz
 * listening neighbours, excluding every artist of their library and plays; MusicBrainz
 * collaborations and scenes for confidential ones), one step further, then new tracks of their
 * recent artists. `rotate` draws other neighbours for a refresh.
 */
export async function discoveryHome(
  sources: HomeSources,
  user: string,
  options: { rotate?: boolean; random?: () => number } = {},
) {
  const page = await explorer(sources, user, options);
  const { profile, seedNames } = page;
  const recent = discoverySeeds(page.history);
  // Seeds: three favourites, the recent artists, then the others. Only artists with a
  // MusicBrainz ID have neighbours and many niche ones have none: they are tried a few at a
  // time until the shelves are full.
  const candidates: Candidate[] = [];
  const addSeed = (artist: Candidate) => {
    if (seedNames.has(nameKey(artist.name))) return;
    seedNames.add(nameKey(artist.name));
    candidates.push(artist);
  };
  const favourites = profile.artists.slice(0, HOME_RULES.tasteSeeds);
  const recentArtists = recent.filter((seed) => seed.kind === "artist");
  favourites.slice(0, 3).forEach(addSeed);
  for (const seed of recentArtists.slice(0, HOME_RULES.recentSeeds))
    addSeed(profile.artists.find((artist) => nameKey(artist.name) === nameKey(seed.query)) ?? { name: seed.query });
  favourites.slice(3).forEach(addSeed);

  const plans: Plan[] = [];
  const scenes = new Set<string>();
  for (
    let at = 0;
    at < candidates.length && plans.length < HOME_RULES.neighbourSections;
    at += HOME_RULES.concurrency
  ) {
    const batch = await page.run(
      candidates.slice(at, at + HOME_RULES.concurrency).map((candidate) => () => page.around(candidate, scenes)),
    );
    for (const entry of batch) {
      if (!entry || plans.length >= HOME_RULES.neighbourSections) continue;
      const planned = page.plan(entry.seed, entry.artists, entry.shelf, entry.why);
      if (planned) plans.push(planned);
    }
  }
  const sections = await page.fill(plans);

  const ownArtists = recentArtists.slice(0, 2);
  const ownPages = await page.run(ownArtists.map((seed) => () => page.find(seed.query)));
  const own = ownArtists.flatMap((seed, index) =>
    page.tracksOf(seed.query, ownPages[index]?.results).map((item) => page.take(item, seed.reason, seed.query)),
  );
  if (own.length)
    sections.push({
      id: "artists",
      kind: "artists",
      title: "De tes artistes, pas encore chez toi",
      reason: "D’autres titres des artistes que tu écoutes en ce moment",
      items: own,
    });

  return page.page(
    sections,
    [
      ...new Set([
        ...plans.filter((plan) => plan.found.length).map((plan) => plan.seed.name),
        ...ownArtists.map((seed) => seed.query),
      ]),
    ],
    !profile.artists.length && !recent.length
      ? "Écoute quelques morceaux pour recevoir des découvertes selon tes goûts."
      : "Aucune nouvelle découverte cette fois. Actualise ou explore une scène.",
  );
}

/**
 * A scene: artists MusicBrainz files under this genre that the listener does not know yet,
 * with their songs, then one step further.
 */
export async function discoveryScene(
  sources: HomeSources,
  user: string,
  genre: string,
  options: { rotate?: boolean; random?: () => number } = {},
) {
  const page = await explorer(sources, user, options);
  const artists = await page.run([() => sources.tagged(genre)]);
  const { shelf, why } = sceneShelf(genre);
  const planned = page.plan({ name: genre, mbid: "" }, artists[0] ?? [], shelf, why, HOME_RULES.sceneArtists);
  const sections = await page.fill(planned ? [planned] : [], { further: false });
  return page.page(
    sections,
    [genre],
    `MusicBrainz ne connaît pas encore d’autres artistes ${genre} que tu n’aies pas. Essaie une autre scène.`,
  );
}

/**
 * Around one artist, known or just discovered: their songs the listener does not have, their
 * listening neighbours, the artists they recorded with, then one step further.
 */
export async function discoveryArtist(
  sources: HomeSources,
  user: string,
  name: string,
  options: { rotate?: boolean; random?: () => number } = {},
) {
  const page = await explorer(sources, user, options);
  page.seedNames.add(nameKey(name));
  const known = page.profile.artists.find((artist) => nameKey(artist.name) === nameKey(name));
  const [mbid] = await page.run([async () => known?.mbid ?? (await sources.artistId(name))]);
  const [own] = await page.run([() => page.find(name)]);
  const songs = page
    .tracksOf(name, own?.results, HOME_RULES.artistSongs)
    .map((item) => page.take(item, `Un titre de ${name} que tu n’as pas`, name));
  const sections: HomeSection[] = songs.length
    ? [
        {
          id: `songs:${nameKey(name)}`,
          kind: "artists",
          title: `Écouter ${name}`,
          reason: `Ses titres qui ne sont pas encore dans ta bibliothèque`,
          items: songs,
        },
      ]
    : [];
  if (mbid) {
    const seed = { name, mbid };
    const [neighbours, together] = await page.run([
      () => sources.similar(mbid),
      () => sources.collaborators(mbid),
    ]);
    const near = neighbourShelf(name, mbid);
    const withHim = collaborationShelf(name, mbid);
    const plans = [
      page.plan(seed, neighbours ?? [], { ...near.shelf, title: `Proches de ${name}` }, near.why, HOME_RULES.artistNeighbours),
      page.plan(seed, together ?? [], withHim.shelf, withHim.why, HOME_RULES.artistCollaborators),
    ].filter((planned): planned is Plan => !!planned);
    sections.push(...(await page.fill(plans)));
  }
  return page.page(
    sections,
    [name],
    mbid
      ? `Rien de nouveau autour de ${name} pour l’instant. Reviens plus tard : la page se complète au fil des visites.`
      : `MusicBrainz ne connaît pas ${name} : impossible de trouver ses voisins.`,
  );
}
