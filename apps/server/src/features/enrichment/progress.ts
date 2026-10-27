import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { jobs, videos, type Executor } from "../../db/index.ts";
import { inLibraryOf } from "../library/index.ts";

/** Explicit account opt-in; never enables the public catalog globally. */
export function enrichmentAccounts(): string[] {
  return [
    ...new Set(
      (process.env["MUSICBRAINZ_ACCOUNT_IDS"] ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) =>
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id),
        ),
    ),
  ];
}
export const enrichmentBatchSize = 10;

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
    enabled: enrichmentAccounts().includes(userId),
    batchSize: enrichmentBatchSize,
    checkedAt: new Date().toISOString(),
  };
}
