import { and, eq, exists, lte, sql } from "drizzle-orm";
import {
  playlists,
  userPlaylists,
  type Database,
  type Executor,
} from "../../db/index.ts";
import type { YouTube } from "../../integrations/youtube/index.ts";
import { enqueue, type JobHandler, type JobKind } from "../jobs/index.ts";
import { enrichVideos } from "./enrich.ts";
import { syncPlaylist } from "./sync.ts";

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
  const due = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(
      and(
        eq(playlists.syncEnabled, true),
        lte(playlists.nextSyncAt, sql`now()`),
        exists(
          db
            .select({ one: sql`1` })
            .from(userPlaylists)
            .where(eq(userPlaylists.playlistId, playlists.id)),
        ),
      ),
    );
  for (const { id } of due) {
    await enqueue(db, "sync", id, { playlistId: id });
    await db
      .update(playlists)
      .set({ nextSyncAt: sql`now() + interval '6 hours'` })
      .where(eq(playlists.id, id));
  }
}
