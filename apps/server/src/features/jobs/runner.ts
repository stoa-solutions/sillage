import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "../../db/index.ts";
import type { ClaimedJob, JobKind } from "./contracts.ts";
import { claim, extendLease, finish } from "./store.ts";

export type JobHandler = (job: ClaimedJob) => Promise<void>;

export interface WorkerOptions {
  db: Database;
  /** One handler per job kind, provided by the feature that owns the kind. */
  handlers: Record<JobKind, JobHandler>;
  /** Periodic producers of jobs, run at most once a minute. */
  schedulers: (() => Promise<void>)[];
  /** Kinds this worker cannot run, e.g. YouTube jobs without an API key. */
  exclude?: JobKind[];
  signal: AbortSignal;
}

/** The worker loop: schedule, claim one job, run its handler under a heartbeat, finish it. */
export async function runWorker({
  db,
  handlers,
  schedulers,
  exclude = [],
  signal,
}: WorkerOptions) {
  let scheduled = 0;
  while (!signal.aborted) {
    try {
      if (Date.now() - scheduled > 60000) {
        for (const schedule of schedulers) await schedule();
        scheduled = Date.now();
      }
      const job = await claim(db.orm, { exclude });
      if (!job) {
        await delay(1000);
        continue;
      }
      const heartbeat = setInterval(
        () => void extendLease(db.orm, job).catch(() => {}),
        30000,
      );
      try {
        await handlers[job.kind](job);
        await finish(db.orm, job);
      } catch (error) {
        // Provider messages are kept; stack traces and payloads are not.
        const safeError = new Error(
          error instanceof Error ? error.message : "Task failed",
        );
        await finish(db.orm, job, safeError);
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
    } catch {
      console.error("Worker database or scheduler unavailable");
      await delay(5000);
    }
  }
}
