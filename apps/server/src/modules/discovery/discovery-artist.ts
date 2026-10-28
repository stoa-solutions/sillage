import { artistKey } from "../../integrations/youtube-music/index.ts";
import { artistName } from "../taste/index.ts";

type Owned = {
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
