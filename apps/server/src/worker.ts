import { pool } from "./db.ts";
import { claim, finish, schedule } from "./queue.ts";
import { syncPlaylist, enrichVideos } from "./library.ts";
import { indexText, indexImage } from "./indexing.ts";
import { YouTube } from "./youtube.ts";
import { setTimeout as delay } from "node:timers/promises";
const youtube = new YouTube(process.env.YOUTUBE_API_KEY ?? "", pool);
let stopping = false;
let scheduled = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    if (Date.now() - scheduled > 60000) {
      await schedule(pool);
      scheduled = Date.now();
    }
    const job = await claim(pool, Boolean(process.env.YOUTUBE_API_KEY));
    if (!job) {
      await delay(1000);
      continue;
    }
    const heartbeat = setInterval(
      () =>
        void pool
          .query(
            `UPDATE jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_id=$2 AND status='running'`,
            [job.id, job.lease_id],
          )
          .catch(() => {}),
      30000,
    );
    try {
      if (job.kind === "sync") await syncPlaylist(pool, youtube, job);
      else if (job.kind === "enrich")
        await enrichVideos(pool, youtube, job.payload.ids!.split(","));
      else if (job.kind === "text") await indexText(pool, job.payload.videoId!);
      else if (job.kind === "image")
        await indexImage(pool, job.payload.videoId!);
      await finish(pool, job);
    } catch (error) {
      const safeError = new Error(
        error instanceof Error ? error.message : "Task failed",
      );
      await finish(pool, job, safeError);
      console.error(
        JSON.stringify({
          job: job.id,
          kind: job.kind,
          error: safeError.message,
        }),
      );
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    console.error("Worker database or scheduler unavailable");
    await delay(5000);
  }
}
await pool.end();
