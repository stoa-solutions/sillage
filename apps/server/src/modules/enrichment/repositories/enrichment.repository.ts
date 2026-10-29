import type { MusicMetadata } from "@sillage/core/types";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  jobs,
  memberships,
  userPlaylists,
  videos,
  type Executor,
} from "../../../db/index.ts";
import { enqueue, holdsLease, type ClaimedJob } from "../../jobs/index.ts";
import { inLibraryOf } from "../../library/index.ts";
import {
  enrichmentAccounts,
  enrichmentBatchSize,
  pilotIds,
} from "../enrichment.config.ts";

type VideoRow = typeof videos.$inferSelect;

const counted = (condition: SQL) =>
  sql<number>`count(*) FILTER (WHERE ${condition})::int`;

/**
 * Where MusicBrainz stands for the account's library: decisions taken, videos waiting for
 * YouTube metadata, and the latest job of each video not yet decided.
 */
export async function enrichmentProgress(db: Executor, userId: string) {
  const latestJob = db
    .select({ status: jobs.status, attempts: jobs.attempts })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "musicbrainz"),
        sql`${jobs.payload}->>'videoId' = ${videos.id}`,
      ),
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1)
    .as("latest_job");
  const status = (value: string) => sql`${videos.musicMetadata}->>'status' = ${value}`;
  const undecided = sql`${videos.musicMetadata} IS NULL`;
  const waiting = sql`${undecided} AND ${videos.available}`;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      processed: counted(sql`${videos.musicMetadata} IS NOT NULL`),
      matched: counted(status("matched")),
      ambiguous: counted(status("ambiguous")),
      not_found: counted(status("not_found")),
      unavailable: counted(sql`${undecided} AND NOT ${videos.available}`),
      awaiting_youtube: counted(sql`${waiting} AND ${videos.enrichedAt} IS NULL`),
      queued: counted(sql`${waiting} AND ${latestJob.status} = 'pending'`),
      running: counted(sql`${waiting} AND ${latestJob.status} = 'running'`),
      retrying: counted(
        sql`${waiting} AND ${latestJob.status} = 'pending' AND ${latestJob.attempts} > 0`,
      ),
      failed: counted(sql`${waiting} AND ${latestJob.status} = 'failed'`),
    })
    .from(videos)
    .leftJoinLateral(latestJob, isNull(videos.musicMetadata))
    .where(inLibraryOf(db, userId, videos.id));
  return {
    total: counts?.total ?? 0,
    processed: counts?.processed ?? 0,
    matched: counts?.matched ?? 0,
    ambiguous: counts?.ambiguous ?? 0,
    not_found: counts?.not_found ?? 0,
    unavailable: counts?.unavailable ?? 0,
    awaiting_youtube: counts?.awaiting_youtube ?? 0,
    queued: counts?.queued ?? 0,
    running: counts?.running ?? 0,
    retrying: counts?.retrying ?? 0,
    failed: counts?.failed ?? 0,
  };
}

/** Active in some playlist. */
const inAnyPlaylist = (db: Executor) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(memberships)
      .where(and(eq(memberships.videoId, videos.id), eq(memberships.active, true))),
  );
/**
 * A pilot video, or one in the library of an account that opted in. Both scheduling and
 * execution re-check it, so revoking an account stops its pending work.
 */
export function eligible(db: Executor) {
  const ids = pilotIds(),
    accounts = enrichmentAccounts();
  // Nobody opted in: nothing is eligible (an empty OR would select everything).
  if (!ids.length && !accounts.length) return sql`false`;
  return or(
    ids.length ? inArray(videos.id, ids) : undefined,
    accounts.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(memberships)
            .innerJoin(
              userPlaylists,
              eq(userPlaylists.playlistId, memberships.playlistId),
            )
            .where(
              and(
                eq(memberships.videoId, videos.id),
                eq(memberships.active, true),
                inArray(userPlaylists.userId, accounts),
              ),
            ),
        )
      : undefined,
  );
}

/**
 * Queues at most enrichmentBatchSize MusicBrainz jobs at a time for eligible, undecided videos.
 * `keyFor` makes a changed YouTube identity a new job.
 */
export async function queueEnrichmentBatch(
  db: Executor,
  keyFor: (video: VideoRow) => string,
) {
  await db.transaction(async (tx) => {
    // Serialize concurrent schedulers so the shared queue remains bounded, including delayed retries.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(740074)`);
    const [active] = await tx
      .select({ count: count() })
      .from(jobs)
      .where(
        and(eq(jobs.kind, "musicbrainz"), inArray(jobs.status, ["pending", "running"])),
      );
    const capacity = Math.max(0, enrichmentBatchSize - (active?.count ?? 0));
    if (!capacity) return;
    const due = await tx
      .select()
      .from(videos)
      .where(
        and(
          eligible(tx),
          eq(videos.available, true),
          isNotNull(videos.enrichedAt),
          isNull(videos.musicMetadata),
          inAnyPlaylist(tx),
          // Not while a job runs or waits, nor within a day of a final failure.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(jobs)
              .where(
                and(
                  eq(jobs.kind, "musicbrainz"),
                  sql`${jobs.payload}->>'videoId' = ${videos.id}`,
                  or(
                    inArray(jobs.status, ["pending", "running"]),
                    and(
                      eq(jobs.status, "failed"),
                      gt(jobs.completedAt, sql`now() - interval '1 day'`),
                    ),
                  ),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(videos.id))
      .limit(capacity);
    for (const row of due)
      await enqueue(tx, "musicbrainz", keyFor(row), {
        videoId: row.id,
      });
  });
}
/** An eligible, YouTube-enriched video still in some playlist, or null. */
export async function eligibleVideo(db: Executor, id: string) {
  const [row] = await db
    .select()
    .from(videos)
    .where(
      and(
        eligible(db),
        eq(videos.id, id),
        eq(videos.available, true),
        isNotNull(videos.enrichedAt),
        inAnyPlaylist(db),
      ),
    );
  return row ?? null;
}

/**
 * Publishes a decision only while the job holds an unexpired lease (row locked) and the video
 * still has the identity that was matched: a stale worker cannot publish a superseded match.
 */
export async function publishMetadata(
  db: Executor,
  job: ClaimedJob,
  row: VideoRow,
  metadata: MusicMetadata,
) {
  const updated = await db.transaction(async (tx) => {
    if (!(await holdsLease(tx, job, { lock: true, unexpired: true }))) return [];
    return tx
      .update(videos)
      .set({ musicMetadata: metadata })
      .where(
        and(
          eq(videos.id, row.id),
          isNull(videos.musicMetadata),
          sql`${videos.title} IS NOT DISTINCT FROM ${row.title}`,
          sql`${videos.channel} IS NOT DISTINCT FROM ${row.channel}`,
          sql`${videos.durationSeconds} IS NOT DISTINCT FROM ${row.durationSeconds}::double precision`,
        ),
      )
      .returning({ contentHash: videos.contentHash });
  });
  return updated[0] ?? null;
}
