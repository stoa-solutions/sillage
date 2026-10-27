import { z } from "@hono/zod-openapi";

export const listeningOutcomes = [
  "finished",
  "skipped",
  "unavailable",
  "replaced",
] as const;

export const historyEvent = z
  .object({
    id: z.string().uuid(),
    videoId: z.string().regex(/^[\w-]{11}$/),
    title: z.string().max(300),
    channel: z.string().max(200).nullable().optional(),
    outcome: z.enum(listeningOutcomes),
    playedAt: z.string().datetime({ offset: true }),
  })
  .openapi("HistoryEvent");
export const historyUpload = z
  .object({ events: z.array(historyEvent).min(1).max(100) })
  .openapi("HistoryUpload");
// Keyset cursor: plays seen together share a date, so the event ID breaks ties.
export const historyPage = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
  })
  .refine((p) => !p.beforeId || p.before);
export const historyEventsBody = z.object({ events: z.array(historyEvent) });
export const recordedBody = z.object({ recorded: z.number().int() });
export const deletedBody = z.object({ deleted: z.number().int() });
