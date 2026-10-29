import { randomUUID } from "node:crypto";
import { alias } from "drizzle-orm/pg-core";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { jobs, type Executor, type Orm } from "../../../db/index.ts";
import type { ClaimedJob, JobKind } from "../types/jobs.schemas.ts";

/** Attempts before a job stays failed; the delay doubles from 30 s up to 6 h. */
export const MAX_ATTEMPTS = 5;
const LEASE = sql`now() + interval '5 minutes'`;
// Literal, not parameters: PostgreSQL must see it implies the partial unique index.
const isActive = sql`${jobs.status} IN ('pending','running')`;

/**
 * Queues a job once per key: while one is pending or running, the same key returns it instead
 * of adding a duplicate.
 */
export async function enqueue(
  db: Executor,
  kind: JobKind,
  key: string,
  payload: Record<string, string>,
) {
  const [job] = await db
    .insert(jobs)
    .values({ id: randomUUID(), kind, dedupeKey: `${kind}:${key}`, payload })
    .onConflictDoUpdate({
      target: jobs.dedupeKey,
      targetWhere: isActive,
      set: { dedupeKey: sql`excluded.dedupe_key` },
    })
    .returning({ id: jobs.id, status: jobs.status });
  if (!job) throw new Error("Queue insert returned nothing");
  return job;
}

/**
 * Takes the next due job, or one whose worker died (expired lease), under a new lease id: a
 * late result of the dead worker can no longer finish it. Synchronisation comes first, then
 * enrichment, text and the rest. `exclude` skips kinds this worker cannot run.
 */
export async function claim(
  orm: Orm,
  { exclude = [] }: { exclude?: JobKind[] } = {},
): Promise<ClaimedJob | undefined> {
  return orm.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          or(
            and(eq(jobs.status, "pending"), lte(jobs.availableAt, sql`now()`)),
            and(eq(jobs.status, "running"), lt(jobs.leaseUntil, sql`now()`)),
          ),
          exclude.length ? notInArray(jobs.kind, exclude) : undefined,
        ),
      )
      .orderBy(
        sql`CASE ${jobs.kind} WHEN 'sync' THEN 0 WHEN 'enrich' THEN 1 WHEN 'text' THEN 2 ELSE 3 END`,
        jobs.createdAt,
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return undefined;
    const leaseId = randomUUID();
    const [job] = await tx
      .update(jobs)
      .set({
        status: "running",
        attempts: sql`${jobs.attempts} + 1`,
        leaseUntil: LEASE,
        leaseId,
      })
      .where(eq(jobs.id, next.id))
      .returning();
    return job && { ...job, leaseId };
  });
}

/** Ends a lease: done, retried later with backoff, or failed after MAX_ATTEMPTS. */
export async function finish(orm: Executor, job: ClaimedJob, error?: Error) {
  const status = !error
    ? "done"
    : job.attempts >= MAX_ATTEMPTS
      ? "failed"
      : "pending";
  const delay = Math.min(21600, 30 * 2 ** job.attempts);
  await orm
    .update(jobs)
    .set({
      status,
      error: error?.message.slice(0, 300) ?? null,
      leaseUntil: null,
      availableAt: sql`now() + ${delay} * interval '1 second'`,
      completedAt: status === "pending" ? null : sql`now()`,
    })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.leaseId, job.leaseId),
        eq(jobs.status, "running"),
      ),
    );
}

/** Heartbeat of a long job, so it is not taken over while it still runs. */
export async function extendLease(orm: Executor, job: ClaimedJob) {
  await orm
    .update(jobs)
    .set({ leaseUntil: LEASE })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.leaseId, job.leaseId),
        eq(jobs.status, "running"),
      ),
    );
}

/**
 * True while this job still holds its lease: a replaced worker must not write its result.
 * `lock` keeps the job row locked until the caller's transaction ends, so the lease cannot be
 * taken over between this check and the writes; `unexpired` also refuses an expired lease.
 */
export async function holdsLease(
  orm: Executor,
  job: ClaimedJob,
  { lock = false, unexpired = false } = {},
) {
  const query = orm
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.leaseId, job.leaseId),
        eq(jobs.status, "running"),
        unexpired ? gt(jobs.leaseUntil, sql`now()`) : undefined,
      ),
    );
  const rows = lock ? await query.for("update") : await query;
  return rows.length > 0;
}

/** Maintenance: the newest failed job of each key goes back to pending, unless one is active. */
export async function retryFailed(orm: Executor) {
  const active = alias(jobs, "active");
  const newest = alias(jobs, "newest");
  const retried = await orm
    .update(jobs)
    .set({
      status: "pending",
      attempts: 0,
      error: null,
      availableAt: sql`now()`,
      completedAt: null,
    })
    .where(
      and(
        eq(jobs.status, "failed"),
        notExists(
          orm
            .select({ id: active.id })
            .from(active)
            .where(
              and(
                eq(active.dedupeKey, jobs.dedupeKey),
                inArray(active.status, ["pending", "running"]),
              ),
            ),
        ),
        eq(
          jobs.id,
          orm
            .select({ id: newest.id })
            .from(newest)
            .where(eq(newest.dedupeKey, jobs.dedupeKey))
            .orderBy(desc(newest.createdAt))
            .limit(1),
        ),
      ),
    )
    .returning({ id: jobs.id });
  return retried.length;
}
