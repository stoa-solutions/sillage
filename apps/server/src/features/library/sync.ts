import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, ne, sql } from "drizzle-orm";
import type { Video } from "@playlist-recall/core/types";
import { documentText, hash } from "../../content.ts";
import {
  memberships,
  playlists,
  syncRuns,
  videos,
  type Database,
  type Executor,
} from "../../db/index.ts";
import { enqueueMissing } from "../../indexing.ts";
import type { YouTube } from "../../integrations/youtube/index.ts";
import { enqueue, holdsLease, type ClaimedJob } from "../jobs/index.ts";

/** Videos refreshed from YouTube at most once a day; enrich jobs carry 50 ids (one API call). */
const ENRICH_BATCH = 50;

/**
 * A YouTube playlist becomes the new generation of its snapshot: entries seen are upserted, an
 * entry missing from two consecutive snapshots becomes inactive. Nothing is replaced unless the
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
  await db.orm.insert(syncRuns).values({ id: runId, playlistId: id });
  await db.orm
    .update(playlists)
    .set({ status: "syncing", error: null })
    .where(eq(playlists.id, id));
  try {
    const snapshot = await youtube.playlist(id);
    await db.orm.transaction(async (tx) => {
      if (!(await holdsLease(tx, job, { lock: true })))
        throw new Error("Synchronisation remplacée par une nouvelle tentative.");
      const [updated] = await tx
        .update(playlists)
        .set({ title: snapshot.title, generation: sql`${playlists.generation} + 1` })
        .where(eq(playlists.id, id))
        .returning({ generation: playlists.generation });
      if (!updated) throw new Error("Playlist inconnue.");
      const generation = updated.generation;
      if (generation === 1) await replaceImportedSeeds(tx, id, snapshot.entries);
      for (const entry of snapshot.entries) {
        const placeholder: Video = {
          id: entry.videoId,
          title: entry.title,
          channel: entry.channel,
          durationSeconds: null,
          description: "",
          tags: [],
          publishedAt: null,
          thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${entry.videoId}`,
        };
        await tx
          .insert(videos)
          .values({
            id: placeholder.id,
            title: placeholder.title,
            channel: placeholder.channel,
            thumbnailUrl: placeholder.thumbnailUrl,
            contentHash: hash(documentText(placeholder)),
          })
          .onConflictDoNothing({ target: videos.id });
        await tx
          .insert(memberships)
          .values({
            key: entry.key,
            playlistId: id,
            videoId: entry.videoId,
            position: entry.position,
            addedAt: entry.addedAt === null ? null : new Date(entry.addedAt),
            seenGeneration: generation,
          })
          .onConflictDoUpdate({
            target: memberships.key,
            set: {
              position: sql`excluded.position`,
              addedAt: sql`excluded.added_at`,
              seenGeneration: sql`excluded.seen_generation`,
              missingCount: 0,
              active: true,
            },
          });
      }
      await tx
        .update(memberships)
        .set({
          missingCount: sql`${memberships.missingCount} + 1`,
          active: sql`${memberships.missingCount} + 1 < 2`,
        })
        .where(
          and(
            eq(memberships.playlistId, id),
            ne(memberships.seenGeneration, generation),
          ),
        );
      await tx
        .update(playlists)
        .set({
          status: "ready",
          error: null,
          lastSyncAt: sql`now()`,
          nextSyncAt: sql`now() + interval '6 hours'`,
        })
        .where(eq(playlists.id, id));
      await tx
        .update(syncRuns)
        .set({
          status: "done",
          entries: snapshot.entries.length,
          finishedAt: sql`now()`,
        })
        .where(eq(syncRuns.id, runId));
    });
    await enqueueStaleVideos(db.orm, id);
    await enqueueMissing(db);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur de synchronisation";
    await db.orm
      .update(syncRuns)
      .set({ status: "error", error: message, finishedAt: sql`now()` })
      .where(eq(syncRuns.id, runId));
    await db.orm
      .update(playlists)
      .set({ status: "error", error: message })
      .where(eq(playlists.id, id));
    throw error;
  }
}

/**
 * The first synchronisation of an imported playlist replaces its seed memberships. The old
 * export has no YouTube item ids, so occurrences are matched, not positions: newly added videos
 * can shift every position of an existing playlist.
 */
async function replaceImportedSeeds(
  tx: Executor,
  playlistId: string,
  entries: { videoId: string }[],
) {
  const remaining = new Map<string, number>();
  for (const entry of entries)
    remaining.set(entry.videoId, (remaining.get(entry.videoId) ?? 0) + 1);
  const seeds = await tx
    .select({ key: memberships.key, videoId: memberships.videoId })
    .from(memberships)
    .where(
      and(eq(memberships.playlistId, playlistId), like(memberships.key, "seed:%")),
    )
    .orderBy(asc(memberships.position), asc(memberships.key));
  const matched: string[] = [];
  for (const seed of seeds) {
    const left = remaining.get(seed.videoId) ?? 0;
    if (left <= 0) continue;
    remaining.set(seed.videoId, left - 1);
    matched.push(seed.key);
  }
  if (matched.length)
    await tx.delete(memberships).where(inArray(memberships.key, matched));
}

/** Queues metadata refreshes for the playlist's videos never or not recently enriched. */
async function enqueueStaleVideos(db: Executor, playlistId: string) {
  const stale = await db
    .selectDistinct({ id: videos.id })
    .from(videos)
    .innerJoin(memberships, eq(memberships.videoId, videos.id))
    .where(
      and(
        eq(memberships.playlistId, playlistId),
        eq(memberships.active, true),
        sql`(${videos.enrichedAt} IS NULL OR ${videos.enrichedAt} < now() - interval '1 day')`,
      ),
    )
    .orderBy(asc(videos.id));
  for (let i = 0; i < stale.length; i += ENRICH_BATCH) {
    const ids = stale
      .slice(i, i + ENRICH_BATCH)
      .map((row) => row.id)
      .join(",");
    await enqueue(db, "enrich", hash(ids), { ids });
  }
}
