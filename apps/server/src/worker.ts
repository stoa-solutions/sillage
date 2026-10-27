import { pool } from "./db/index.ts";
import { runWorker } from "./features/jobs/index.ts";
import {
  libraryJobHandlers,
  scheduleSync,
  YOUTUBE_JOB_KINDS,
} from "./features/library/index.ts";
import { indexImage, indexText } from "./indexing.ts";
import { YouTube } from "./integrations/youtube/index.ts";
import {
  enrichMusic,
  scheduleMusicEnrichment,
} from "./features/enrichment/index.ts";

// The worker process: each feature registers the job kinds it owns.
const key = process.env["YOUTUBE_API_KEY"] ?? "";
const youtube = new YouTube(key, pool);
const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());
const videoId = (payload: Record<string, string>) => {
  const id = payload["videoId"];
  if (!id) throw new Error("Tâche sans vidéo.");
  return id;
};
await runWorker({
  db: pool,
  handlers: {
    ...libraryJobHandlers(pool, youtube),
    text: (job) => indexText(pool, videoId(job.payload)),
    image: (job) => indexImage(pool, videoId(job.payload)),
    musicbrainz: (job) => enrichMusic(pool, job),
  },
  schedulers: [() => scheduleSync(pool.orm), () => scheduleMusicEnrichment(pool)],
  exclude: key ? [] : YOUTUBE_JOB_KINDS,
  signal: stop.signal,
});
await pool.end();
