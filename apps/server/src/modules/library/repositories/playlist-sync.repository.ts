import { and, asc, eq, inArray, like, ne, sql } from "drizzle-orm";
import type { Video } from "@sillage/core/types";
import { documentText, hash } from "../../../shared/content.ts";
import {
  memberships,
  playlists,
  syncRuns,
  videos,
  type Executor,
} from "../../../db/index.ts";
import type { PlaylistEntry } from "../../../integrations/youtube/index.ts";
import { holdsLease, type ClaimedJob } from "../../jobs/index.ts";

export async function startSyncRun(db: Executor, runId: string, id: string) {
  await db.insert(syncRuns).values({ id: runId, playlistId: id });
  await db
    .update(playlists)
    .set({ status: "syncing", error: null })
    .where(eq(playlists.id, id));
}

export async function failSyncRun(
  db: Executor,
  runId: string,
  id: string,
  message: string,
) {
  await db
    .update(syncRuns)
    .set({ status: "error", error: message, finishedAt: sql`now()` })
    .where(eq(syncRuns.id, runId));
  await db
    .update(playlists)
    .set({ status: "error", error: message })
    .where(eq(playlists.id, id));
}

/**
 * Writes a complete YouTube snapshot as the playlist's next generation, in one transaction and
 * only while the job still holds its lease: entries seen are upserted, an entry missing from
 * two consecutive snapshots becomes inactive.
 */
export async function applySnapshot(
  db: Executor,
  job: ClaimedJob,
  runId: string,
  id: string,
  snapshot: { title: string; entries: PlaylistEntry[] },
) {
  await db.transaction(async (tx) => {
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

/** Videos of the playlist never or not recently enriched, in id order. */
export async function staleVideoIds(db: Executor, playlistId: string) {
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
  return stale.map((row) => row.id);
}
