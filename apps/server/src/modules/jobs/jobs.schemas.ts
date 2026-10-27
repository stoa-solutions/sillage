import { z } from "@hono/zod-openapi";
import { jobKind, jobStatus, type jobs } from "../../db/index.ts";

export type JobKind = (typeof jobKind.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
/** A job this worker holds: its lease id proves it still owns it. */
export type ClaimedJob = typeof jobs.$inferSelect & { leaseId: string };

export const jobBody = z
  .object({ id: z.uuid(), status: z.enum(jobStatus.enumValues) })
  .openapi("Job");
export const retriedBody = z.object({ retried: z.number().int() });
