import { artistKey } from "../../integrations/youtube-music/index.ts";
import { artistName } from "../taste/index.ts";

type Owned = {
  id?: string;
  thumbnailUrl?: string;
  title: string | null;
  channel: string | null;
  musicMetadata: unknown;
  plays: number;
};

/**
 * The listener's own songs by this artist: credited as its main artist (MusicBrainz, a Topic
 * channel or « Artist - Song »), or as a featured artist on MusicBrainz. Most played first.
 */
export function ownTracksOf<T extends Owned>(rows: T[], name: string, limit = 50): T[] {
  const wanted = artistKey(name);
  if (!wanted) return [];
  return rows
    .filter((row) => {
      const metadata = row.musicMetadata as
        | { status?: string; artists?: { name: string; role: string }[] }
        | null;
      const main = artistName({ title: row.title, channel: row.channel, musicMetadata: metadata });
      if (main && artistKey(main) === wanted) return true;
      return (
        metadata?.status === "matched" &&
        (metadata.artists ?? []).some((artist) => artistKey(artist.name) === wanted)
      );
    })
    .sort((a, b) => b.plays - a.plays || (a.title ?? "").localeCompare(b.title ?? "", "fr"))
    .slice(0, limit);
}

const mainArtist = (row: Owned) =>
  artistName({
    title: row.title,
    channel: row.channel,
    musicMetadata: row.musicMetadata as { status?: string; artists?: { name: string; role: string }[] } | null,
  });

/**
 * The artists of the library, each with its song count, the account's plays and the cover of
 * its most played song: most played first, then the largest.
 */
export function libraryArtists(rows: (Owned & { id: string; thumbnailUrl: string })[]) {
  const groups = new Map<string, { name: string; tracks: number; plays: number; top: (typeof rows)[number] }>();
  for (const row of rows) {
    const name = mainArtist(row);
    const key = name ? artistKey(name) : "";
    if (!name || !key) continue;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { name, tracks: 1, plays: row.plays, top: row });
      continue;
    }
    group.tracks += 1;
    group.plays += row.plays;
    if (row.plays > group.top.plays) group.top = row;
  }
  return [...groups.values()]
    .sort((a, b) => b.plays - a.plays || b.tracks - a.tracks || a.name.localeCompare(b.name, "fr"))
    .map(({ name, tracks, plays, top }) => ({ name, tracks, plays, coverVideoId: top.id, cover: top.thumbnailUrl }));
}
