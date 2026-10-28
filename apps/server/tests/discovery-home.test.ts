import { expect, it, vi } from "vitest";
import {
  sceneOf,
  discoveryArtist,
  discoveryHome,
  discoveryScene,
  discoverySeeds,
  listenerProfile,
} from "../src/modules/discovery/index.ts";
import { required } from "./support/required.ts";

const played = {
  video_id: "played00001",
  title: "Known Song",
  channel: "Artist - Topic",
  outcome: "finished",
  music_metadata: null,
};
const history = [played];
const video = (id: string, title: string, channel = "Artist") => ({
  id,
  title,
  channel,
  durationSeconds: 200,
  thumbnailUrl: "https://i.ytimg.com/test",
  url: `https://youtube.com/watch?v=${id}`,
});
const found = (...items: { id: string; title: string; channel?: string; owned?: boolean }[]) => ({
  results: items.map((item) => ({
    video: video(item.id, item.title, item.channel),
    inLibrary: item.owned ?? false,
  })),
  nextPageToken: null,
});
const matched = (artist: string, id: string, genres: string[] = []) => ({
  status: "matched" as const,
  source: "MusicBrainz" as const,
  checkedAt: "2026-10-28T00:00:00Z",
  searchText: artist,
  artists: [{ id, name: artist, role: "primary" as const }],
  albums: [],
  genres,
  artistGenres: [],
});
const neighbour = (name: string, mbid: string) => ({ name, mbid, score: 100 });
/** A listener who loves Maribou State and owns a Bonobo track. */
const profile = listenerProfile(
  [
    { title: "Steal", channel: "Maribou State", musicMetadata: matched("Maribou State", "ms", ["electronic"]), plays: 9 },
    { title: "Kerala", channel: "Bonobo", musicMetadata: matched("Bonobo", "bo", ["electronic"]), plays: 0 },
    { title: "Rap song", channel: "Rapper", musicMetadata: matched("Rapper", "ra", ["hip hop"]), plays: 1 },
  ],
  [{ name: "Maribou State" }],
);
const sources = (overrides: Partial<Parameters<typeof discoveryHome>[0]> = {}) => ({
  history: vi.fn().mockResolvedValue([]),
  profile: vi.fn().mockResolvedValue(profile),
  artistId: vi.fn().mockResolvedValue(undefined),
  cached: vi.fn().mockReturnValue(false),
  collaborators: vi.fn().mockResolvedValue([]),
  tagged: vi.fn().mockResolvedValue([]),
  similar: vi.fn().mockResolvedValue([
    neighbour("Bonobo", "bo"),
    neighbour("Kiasmos", "ki"),
    neighbour("Khruangbin", "kh"),
  ]),
  search: vi.fn().mockImplementation(async (_user: string, query: string) =>
    query === "Kiasmos"
      ? found({ id: "kiasmos0001", title: "Kiasmos - Looped", channel: "Erased Tapes" }, { id: "wrongartist", title: "Someone - Else" })
      : query === "Khruangbin"
        ? found({ id: "khruang0001", title: "Maria También", channel: "Khruangbin" }, { id: "khruang0002", title: "Owned", channel: "Khruangbin", owned: true })
        : found(),
  ),
  ...overrides,
});

it("reads the listener's artists, IDs and genres weighted by plays", () => {
  expect(profile.artists).toEqual([
    { name: "Maribou State", mbid: "ms" },
    { name: "Rapper", mbid: "ra" },
  ]);
  expect(profile.knownMbids).toEqual(new Set(["ms", "bo", "ra"]));
  expect(profile.genres).toEqual(["electronic", "hip hop"]);
});

it("uses recent positive history and ignores skips", () => {
  expect(
    discoverySeeds([...history, { ...played, channel: "Skipped", outcome: "skipped" }]),
  ).toEqual([{ query: "Artist", reason: "Parce que tu as écouté Artist", kind: "artist" }]);
});

it("proposes unknown neighbours of a favourite artist, by those artists only, never owned", async () => {
  const given = sources();
  const result = await discoveryHome(given, "alice");
  expect(given.similar).toHaveBeenCalledWith("ms");
  // Bonobo is in the library: never proposed as a discovery.
  expect(given.search).not.toHaveBeenCalledWith("alice", "Bonobo");
  const around = required(result.sections.find((section) => section.kind === "neighbours"));
  expect(around.title).toBe("Autour de Maribou State");
  expect(around.items.map((item) => item.video.id)).toEqual(["kiasmos0001", "khruang0001"]);
  expect(required(around.items[0]).reason).toBe("Kiasmos, proche de Maribou State");
  expect(result.suggestions).toHaveLength(2);
  expect(result.ideas).toEqual(["electronic", "hip hop"]);
  expect(result.sections.map((section) => section.kind)).not.toContain("genre");
});

it("does not invent personal recommendations for an empty account", async () => {
  const given = sources({
    profile: vi.fn().mockResolvedValue(listenerProfile([], [])),
  });
  const result = await discoveryHome(given, "bob");
  expect(result.suggestions).toEqual([]);
  expect(given.search).not.toHaveBeenCalled();
  expect(result.emptyReason).toContain("Écoute quelques morceaux");
});

it("keeps what was found when a neighbour source or a search fails", async () => {
  const given = sources({
    search: vi.fn().mockImplementation(async (_user: string, query: string) => {
      if (query === "Kiasmos") throw new Error("provider failure");
      return query === "Khruangbin"
        ? found({ id: "khruang0001", title: "Maria También", channel: "Khruangbin" })
        : found();
    }),
  });
  const result = await discoveryHome(given, "alice");
  expect(result.suggestions.map((item) => item.video.id)).toEqual(["khruang0001"]);
  expect(result.notice).toContain("Une recherche");
});

it("draws other neighbours on refresh", async () => {
  const many = Array.from({ length: 8 }, (_, index) => neighbour(`New ${index}`, `n${index}`));
  // Pages without a track by these artists: each neighbour is replaced once.
  const search = vi.fn().mockResolvedValue(found({ id: "someone0001", title: "Someone - Else" }));
  const given = sources({
    profile: vi.fn().mockResolvedValue({ ...profile, artists: profile.artists.slice(0, 1) }),
    similar: vi.fn().mockResolvedValue(many),
    search,
  });
  await discoveryHome(given, "alice", { rotate: true, random: () => 0 });
  const queried: string[] = search.mock.calls.map((call) => call[1]);
  // Two neighbours, then two spares since neither had a track: never the first closest one.
  expect(queried.filter((query) => query.startsWith("New "))).toHaveLength(4);
  expect(queried).not.toContain("New 0");
});

it("distinguishes an artist credit from a homonymous song title", async () => {
  const given = sources({
    history: vi.fn().mockResolvedValue([{ ...played, channel: "The Alchemist" }]),
    similar: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      query === "The Alchemist"
        ? found(
            { id: "wrong000001", title: 'Blue Öyster Cult - "The Alchemist" - Official Music Video', channel: "Blue Öyster Cult" },
            { id: "right000001", title: "Freddie Gibbs & The Alchemist - A Thousand Mountains", channel: "Freddie Gibbs" },
          )
        : found(),
    ),
  });
  const result = await discoveryHome(given, "alice");
  const own = required(result.sections.find((section) => section.kind === "artists"));
  expect(own.items.map((item) => item.video.id)).toEqual(["right000001"]);
});

it("rejects a homonymous song on another artist's Topic channel, and mixes", async () => {
  const given = sources({
    similar: vi.fn().mockResolvedValue([neighbour("Phoenix", "ph")]),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      query === "Phoenix"
        ? found(
            { id: "youngthug01", title: "Phoenix", channel: "Young Thug - Topic" },
            { id: "phoenixmix1", title: "Phoenix - Best of Mix", channel: "Phoenix" },
            { id: "phoenix0001", title: "Phoenix - Lisztomania", channel: "Phoenix" },
          )
        : found(),
    ),
  });
  const result = await discoveryHome(given, "alice");
  expect(result.suggestions.map((item) => item.video.id)).toEqual(["phoenix0001"]);
});

it("goes one step further, from the neighbours of a new artist", async () => {
  const given = sources({
    similar: vi.fn().mockImplementation(async (mbid: string) =>
      mbid === "ms" ? [neighbour("Kiasmos", "ki")] : mbid === "ki" ? [neighbour("Ólafur Arnalds", "oa")] : [],
    ),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      query === "Kiasmos"
        ? found({ id: "kiasmos0001", title: "Kiasmos - Looped" })
        : query === "Ólafur Arnalds"
          ? found({ id: "olafur00001", title: "Ólafur Arnalds - Saman" })
          : found(),
    ),
  });
  const result = await discoveryHome(given, "alice");
  const further = required(result.sections.find((section) => section.id === "further"));
  expect(required(further.items[0]).reason).toBe(
    "Ólafur Arnalds, proche de Kiasmos, découvert grâce à Maribou State",
  );
});

it("looks up by name a played artist MusicBrainz has not matched yet", async () => {
  const given = sources({
    profile: vi.fn().mockResolvedValue({ ...profile, artists: [{ name: "Nirvana" }] }),
    artistId: vi.fn().mockResolvedValue("nv"),
  });
  const result = await discoveryHome(given, "alice");
  expect(given.artistId).toHaveBeenCalledWith("Nirvana");
  expect(given.similar).toHaveBeenCalledWith("nv");
  expect(required(result.sections[0]).title).toBe("Autour de Nirvana");
});

it("keeps one version of a song, the studio one first", async () => {
  const given = sources({
    similar: vi.fn().mockResolvedValue([neighbour("Sons of Kemet", "sk")]),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      query === "Sons of Kemet"
        ? found(
            { id: "sofar000001", title: "Sons of Kemet - In the castle of my skin | Sofar London" },
            { id: "studio00001", title: "Sons Of Kemet - In The Castle Of My Skin" },
            { id: "studio00002", title: "Sons Of Kemet - Hustle" },
          )
        : found(),
    ),
  });
  const result = await discoveryHome(given, "alice");
  expect(result.suggestions.map((item) => item.video.id)).toEqual(["studio00001", "studio00002"]);
});

it("spends few fresh searches and stops when the catalog answers nothing", async () => {
  const many = Array.from({ length: 30 }, (_, index) => neighbour(`New ${index}`, `n${index}`));
  const search = vi.fn().mockResolvedValue(found());
  const given = sources({
    profile: vi.fn().mockResolvedValue({
      ...profile,
      artists: Array.from({ length: 8 }, (_, index) => ({ name: `Seed ${index}`, mbid: `s${index}` })),
    }),
    similar: vi.fn().mockImplementation(async (mbid: string) =>
      many.slice(Number(mbid.slice(1)) * 3, Number(mbid.slice(1)) * 3 + 3),
    ),
    search,
  });
  await discoveryHome(given, "alice");
  // Two empty answers in a row: YouTube is throttling, the rest waits for another visit.
  expect(search.mock.calls.length).toBeLessThanOrEqual(3);
});

it("uses kept artist pages beyond the fresh search budget", async () => {
  const given = sources({ cached: vi.fn().mockReturnValue(true) });
  const result = await discoveryHome(given, "alice");
  expect(result.suggestions.map((item) => item.video.id)).toEqual(["kiasmos0001", "khruang0001"]);
});

it("keeps the most precise genre of an artist for its scene", () => {
  expect(sceneOf(["champeta", "cumbia", "digital cumbia", "latin", "pop"])).toBe("digital cumbia");
  expect(sceneOf(["hip hop", "pop"])).toBeUndefined();
});

/** A favourite too confidential for ListenBrainz: Squidji, then Acid Coco. */
const niche = (artists: { name: string; mbid: string; genres?: string[] }[]) =>
  sources({
    profile: vi.fn().mockResolvedValue({ ...profile, artists }),
    similar: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      found({ id: query.slice(0, 6).padEnd(11, "0"), title: `${query} - Song` }),
    ),
  });

it("falls back on the artists a confidential favourite recorded with", async () => {
  const given = {
    ...niche([{ name: "Squidji", mbid: "sq" }]),
    collaborators: vi.fn().mockResolvedValue([neighbour("Jäde", "jd"), neighbour("Maribou State", "ms")]),
  };
  const result = await discoveryHome(given, "alice");
  const shelf = required(result.sections[0]);
  expect(shelf).toMatchObject({ kind: "collaborations", title: "Avec Squidji" });
  // A known artist is never proposed, even as a collaborator.
  expect(shelf.items.map((item) => item.artist)).toEqual(["Jäde"]);
  expect(required(shelf.items[0]).reason).toBe("Jäde a enregistré avec Squidji");
});

it("then on its scene, from its most precise genre", async () => {
  const given = {
    ...niche([{ name: "Acid Coco", mbid: "ac", genres: ["cumbia", "digital cumbia"] }]),
    tagged: vi.fn().mockResolvedValue([neighbour("Chancha Vía Circuito", "cv")]),
  };
  const result = await discoveryHome(given, "alice");
  expect(given.tagged).toHaveBeenCalledWith("digital cumbia");
  const shelf = required(result.sections[0]);
  expect(shelf).toMatchObject({ kind: "scene", title: "Scène digital cumbia" });
  expect(required(shelf.items[0]).reason).toBe("Chancha Vía Circuito, digital cumbia comme Acid Coco");
});

it("explores a scene with the artists of the genre the listener does not have", async () => {
  const given = {
    ...niche([]),
    tagged: vi.fn().mockResolvedValue([neighbour("Maribou State", "ms"), neighbour("Chancha Vía Circuito", "cv")]),
  };
  const result = await discoveryScene(given, "alice", "digital cumbia");
  expect(given.tagged).toHaveBeenCalledWith("digital cumbia");
  expect(result.sections.map((section) => section.title)).toEqual(["Scène digital cumbia"]);
  expect(result.suggestions.map((item) => item.artist)).toEqual(["Chancha Vía Circuito"]);
  // Electronic and hip hop are too wide to be scenes of their own.
  expect(result.scenes).toEqual([]);
});

it("explores around an artist: their songs, their neighbours, never themselves", async () => {
  const given = sources({ artistId: vi.fn().mockResolvedValue("ki") });
  const result = await discoveryArtist(given, "alice", "Kiasmos");
  expect(given.similar).toHaveBeenCalledWith("ki");
  expect(result.sections.map((section) => section.title)).toEqual(["Écouter Kiasmos", "Proches de Kiasmos"]);
  expect(result.sections.map((section) => section.items.map((item) => item.video.id))).toEqual([
    ["kiasmos0001"],
    ["khruang0001"],
  ]);
  expect(result.artists).toEqual(["Maribou State", "Rapper"]);
});

it("says so when MusicBrainz does not know an artist", async () => {
  const result = await discoveryArtist(sources(), "alice", "Inconnu");
  expect(result.emptyReason).toContain("MusicBrainz ne connaît pas Inconnu");
});
