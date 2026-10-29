import { z } from "@hono/zod-openapi";
import { jobKind, jobStatus, type jobs } from "../../../db/index.ts";

export type JobKind = (typeof jobKind.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
/** A job this worker holds: its lease id proves it still owns it. */
export type ClaimedJob = typeof jobs.$inferSelect & { leaseId: string };

export const jobBody = z
  .object({ id: z.uuid(), status: z.enum(jobStatus.enumValues) })
  .openapi("Job");
const videoId = z.string().regex(/^[\w-]{11}$/);
/** What each kind of job carries, checked before its handler runs. */
export const jobPayloads = {
  sync: z.object({ playlistId: z.string().regex(/^[\w:-]{1,200}$/) }),
  enrich: z.object({
    ids: z
      .string()
      .refine((ids) => ids.split(",").every((id) => videoId.safeParse(id).success)),
  }),
  text: z.object({ videoId }),
  image: z.object({ videoId }),
  musicbrainz: z.object({ videoId }),
} satisfies Record<JobKind, z.ZodType>;
