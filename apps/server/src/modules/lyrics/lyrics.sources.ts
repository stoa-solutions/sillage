import type { Database } from "../../db/index.ts";
import { Lrclib, type LyricsSource } from "../../integrations/lrclib/index.ts";
import { lyricsOvh } from "../../integrations/lyrics-ovh/index.ts";
import { YouTube } from "../../integrations/youtube/index.ts";
import { youTubeMusic } from "../../integrations/youtube-music/index.ts";
import type { LyricsSources } from "./services/lyrics.service.ts";

/**
 * The sources in production: LRCLIB, YouTube Music, lyrics.ovh, and the YouTube API to name a
 * video the server never saw. A lone LyricsSource (tests) keeps LRCLIB only.
 */
export function defaultLyricsSources(
  db: Database,
  given?: LyricsSource | LyricsSources,
): LyricsSources {
  if (given) return "search" in given ? { lrclib: given } : given;
  const youtube = new YouTube(process.env["YOUTUBE_API_KEY"] ?? "", db);
  return {
    lrclib: new Lrclib(),
    music: youTubeMusic,
    ovh: lyricsOvh,
    describe: async (videoId) => {
      const [video] = await youtube.videos([videoId], true);
      return video
        ? { title: video.title, channel: video.channel, durationSeconds: video.durationSeconds ?? null }
        : null;
    },
  };
}
