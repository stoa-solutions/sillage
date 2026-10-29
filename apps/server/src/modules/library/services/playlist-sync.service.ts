import { randomUUID } from "node:crypto";
import { hash } from "../../../shared/content.ts";
import type { Database } from "../../../db/index.ts";
import { enqueueMissing } from "../../indexing/index.ts";
import type { YouTube } from "../../../integrations/youtube/index.ts";
import { enqueue, type ClaimedJob } from "../../jobs/index.ts";
import {
  applySnapshot,
  failSyncRun,
  staleVideoIds,
  startSyncRun,
} from "../repositories/playlist-sync.repository.ts";

/** Videos refreshed from YouTube at most once a day; enrich jobs carry 50 ids (one API call). */
const ENRICH_BATCH = 50;

/**
 * A YouTube playlist becomes the new generation of its snapshot. Nothing is replaced unless the
 * whole playlist was read, and a job that lost its lease cannot commit.
 */
export async function syncPlaylist(
  db: Database,
  youtube: YouTube,
  job: ClaimedJob,
) {
  const id = job.payload["playlistId"];
  if (!id) throw new Error("Tâche de synchronisation sans playlist.");
  const runId = randomUUID();
  await startSyncRun(db.orm, runId, id);
  try {
    const snapshot = await youtube.playlist(id);
    await applySnapshot(db.orm, job, runId, id, snapshot);
    const stale = await staleVideoIds(db.orm, id);
    for (let i = 0; i < stale.length; i += ENRICH_BATCH) {
      const ids = stale.slice(i, i + ENRICH_BATCH).join(",");
      await enqueue(db.orm, "enrich", hash(ids), { ids });
    }
    await enqueueMissing(db);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur de synchronisation";
    await failSyncRun(db.orm, runId, id, message);
    throw error;
  }
}
