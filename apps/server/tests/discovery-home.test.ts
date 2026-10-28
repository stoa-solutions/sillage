import { expect, it, vi } from "vitest";
import {
  discoveryHome,
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
});

it("explores the listener's genres without their usual artists", async () => {
  const given = sources({
    similar: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockImplementation(async (_user: string, query: string) =>
      query === "electronic official music video"
        ? found(
            { id: "known000001", title: "Maribou State - Turnmills", channel: "Maribou State" },
            { id: "unknown0001", title: "Caribou - Can't Do Without You", channel: "Caribou" },
          )
        : found(),
    ),
  });
  const result = await discoveryHome(given, "alice");
  const genre = required(result.sections.find((section) => section.kind === "genre"));
  expect(genre.title).toBe("Côté electronic");
  expect(genre.items.map((item) => item.video.id)).toEqual(["unknown0001"]);
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
  const search = vi.fn().mockResolvedValue(found());
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
      query === "The Alchemist official music"
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
    "Ólafur Arnalds, proche de Kiasmos, lui-même proche de Maribou State",
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
