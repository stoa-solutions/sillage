import type { Database, Executor } from "../../db/index.ts";
import type { YouTube } from "../../integrations/youtube/index.ts";
import { enqueue, type JobHandler, type JobKind } from "../jobs/index.ts";
import { enrichVideos } from "./services/video-metadata.service.ts";
import { playlistsDueForSync, postponeSync } from "./repositories/library.repository.ts";
import { syncPlaylist } from "./services/playlist-sync.service.ts";

/** Kinds that call the YouTube Data API: skipped by a worker without a key. */
export const YOUTUBE_JOB_KINDS: JobKind[] = ["sync", "enrich"];

export function libraryJobHandlers(
  db: Database,
  youtube: YouTube,
): Record<"sync" | "enrich", JobHandler> {
  return {
    sync: (job) => syncPlaylist(db, youtube, job),
    enrich: (job) =>
      enrichVideos(db, youtube, (job.payload["ids"] ?? "").split(",")),
  };
}

/**
 * Periodic synchronisation (SYNC_ENABLED), every 6 hours per playlist. A playlist no account
 * follows any more is left alone: quota and worker time.
 */
export async function scheduleSync(db: Executor) {
  if (process.env["SYNC_ENABLED"] !== "true") return;
  for (const id of await playlistsDueForSync(db)) {
    await enqueue(db, "sync", id, { playlistId: id });
    await postponeSync(db, id);
  }
}
