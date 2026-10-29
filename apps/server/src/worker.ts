import { checkEnvironment } from "./shared/config.ts";
import { pool } from "./db/index.ts";
import { runWorker } from "./modules/jobs/index.ts";
import {
  libraryJobHandlers,
  scheduleSync,
  YOUTUBE_JOB_KINDS,
} from "./modules/library/index.ts";
import { indexingJobHandlers } from "./modules/indexing/index.ts";
import { YouTube } from "./integrations/youtube/index.ts";
import {
  enrichMusic,
  scheduleMusicEnrichment,
} from "./modules/enrichment/index.ts";
import { defaultLyricsSources, prefetchLyrics } from "./modules/lyrics/index.ts";

// The worker process: each module registers the job kinds it owns.
checkEnvironment("worker");
const key = process.env["YOUTUBE_API_KEY"] ?? "";
const youtube = new YouTube(key, pool);
const lyrics = defaultLyricsSources(pool);
const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());
await runWorker({
  db: pool,
  handlers: {
    ...libraryJobHandlers(pool, youtube),
    ...indexingJobHandlers(pool),
    musicbrainz: (job) => enrichMusic(pool, job),
  },
  schedulers: [
    () => scheduleSync(pool.orm),
    () => scheduleMusicEnrichment(pool),
    // Lyrics of the library ahead of time, a few a minute.
    () => prefetchLyrics(pool, lyrics),
  ],
  exclude: key ? [] : YOUTUBE_JOB_KINDS,
  signal: stop.signal,
});
await pool.end();
