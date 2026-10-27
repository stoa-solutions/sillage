import type { Database } from "./db/index.ts";
import type { Discovery } from "./discovery.ts";
import { normalizeMusic } from "./music-matching.ts";
import type { MusicMetadata } from "@playlist-recall/core/types";

type HistoryRow = {
  video_id: string;
  title: string;
  channel: string | null;
  outcome: string;
  music_metadata: MusicMetadata | null;
};
export interface DiscoverySeed {
  query: string;
  reason: string;
  kind: "artist" | "genre";
}
const titleKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Pure taste seeds: recent positive listening, enriched genres first, no model call. */
export function discoverySeeds(history: HistoryRow[]): DiscoverySeed[] {
  const seeds: DiscoverySeed[] = [];
  const seen = new Set<string>();
  const add = (
    query: string | undefined,
    reason: string,
    kind: DiscoverySeed["kind"],
  ) => {
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
    const metadata =
      row.music_metadata?.status === "matched" ? row.music_metadata : undefined;
    const artist =
      metadata?.artists?.[0]?.name ??
      row.channel?.replace(/\s*[-–]\s*Topic$/i, "") ??
      undefined;
    const genres = metadata?.genres?.length
      ? metadata.genres
      : metadata?.artistGenres;
    if (genres?.[0])
      add(
        genres[0],
        `Pour explorer ${genres[0]}, autour de tes écoutes récentes`,
        "genre",
      );
    add(artist, `Parce que tu as écouté ${artist ?? row.title}`, "artist");
    if (seeds.length >= 3) break;
  }
  return seeds.slice(0, 3);
}

/** An artist name in a song title is not an artist credit (e.g. a song called The Alchemist). */
function matchesArtistSeed(
  seed: DiscoverySeed,
  title: string,
  channel: string,
) {
  if (seed.kind === "genre") return true;
  const artist = normalizeMusic(seed.query);
  const contains = (value: string) =>
    (" " + normalizeMusic(value) + " ").includes(" " + artist + " ");
  if (contains(channel)) return true;
  const credit = title.split(/\s+[-–—]\s+/)[0];
  if (contains(credit)) return true;
  return ["feat ", "ft ", "featuring ", "avec "].some((marker) =>
    normalizeMusic(title).includes(marker + artist),
  );
}

/** Per-account history is always reread; only the public source's catalog cache is shared. */
export async function discoveryHome(
  db: Database,
  user: string,
  source: Pick<Discovery, "search">,
) {
  const { rows } = await db.query<HistoryRow>(
    `SELECT h.video_id,h.title,h.channel,h.outcome,v.music_metadata
     FROM listening_history h LEFT JOIN videos v ON v.id=h.video_id
     WHERE h.user_id=$1 ORDER BY h.played_at DESC,h.event_id DESC LIMIT 80`,
    [user],
  );
  const seeds = discoverySeeds(rows);
  const seen = new Set(rows.map((row) => row.video_id));
  const titles = new Set(rows.map((row) => titleKey(row.title)));
  const pages = await Promise.allSettled(
    seeds.map((seed) => source.search(user, seed.query + " official music")),
  );
  const suggestions = [];
  for (let index = 0; index < 12; index++) {
    for (let seedIndex = 0; seedIndex < pages.length; seedIndex++) {
      const page = pages[seedIndex];
      if (page.status !== "fulfilled") continue;
      const candidates = page.value.results.filter(
        (item) =>
          !item.inLibrary &&
          matchesArtistSeed(
            seeds[seedIndex],
            item.video.title ?? "",
            item.video.channel ?? "",
          ) &&
          !/\b(type beat|backing track|tutorial|audiobook|podcast|for drummers?|bpm)\b/i.test(
            item.video.title ?? "",
          ),
      );
      const item = candidates[index];
      if (
        !item ||
        seen.has(item.video.id) ||
        !item.video.title ||
        titles.has(titleKey(item.video.title))
      )
        continue;
      seen.add(item.video.id);
      titles.add(titleKey(item.video.title));
      suggestions.push({ ...item, reason: seeds[seedIndex].reason });
      if (suggestions.length >= 12) break;
    }
    if (suggestions.length >= 12) break;
  }
  return {
    suggestions,
    basedOn: seeds.map((seed) => seed.query),
    notice: pages.some((page) => page.status === "rejected")
      ? "Une recherche n’a pas abouti. Les découvertes disponibles restent affichées."
      : null,
    emptyReason: !seeds.length
      ? "Écoute quelques morceaux pour recevoir des découvertes selon tes goûts."
      : !suggestions.length
        ? "Aucune nouvelle découverte cette fois. Actualise ou explore une envie."
        : null,
  };
}
