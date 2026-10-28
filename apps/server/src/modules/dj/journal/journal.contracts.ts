import { z } from "zod";
import { DJ_SELECTION_LIMIT } from "@sillage/core/dj";

export const journalScope = z.enum(["library", "youtube", "all"]);
export const journalPage = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().uuid().optional(),
});
export const journalEventPage = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z
    .string()
    .regex(/^\d{1,19}$/)
    .refine(
      (value) =>
        /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n,
    )
    .default("0"),
});
const track = z.object({
  id: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(300),
  channel: z.string().max(200).nullable().optional(),
});
export const journalClientEvent = z
  .object({
    id: z.string().uuid(),
    sequence: z.number().int().min(1).max(2147483647),
    occurredAt: z.string().datetime({ offset: true }),
    scope: journalScope,
    visibleScope: journalScope,
    kind: z.enum(["message", "action"]),
    role: z.enum(["user", "assistant"]).optional(),
    content: z.string().max(8192).optional(),
    action: z.string().max(60).optional(),
    requestId: z.string().uuid().optional(),
    current: track.nullable().optional(),
    queueIds: z
      .array(z.string().regex(/^[\w-]{11}$/))
      .max(100)
      .optional(),
    discoveries: z
      .array(track.extend({ inLibrary: z.boolean() }))
      .max(DJ_SELECTION_LIMIT)
      .optional(),
    sources: z
      .array(
        z.object({
          id: z.number().int(),
          title: z.string().max(500),
          url: z.string().url().max(2000),
        }),
      )
      .max(5)
      .optional(),
  })
  .refine(
    (value) =>
      value.kind !== "message" ||
      Boolean(value.role && value.content !== undefined),
    "Message incomplet",
  );
export const journalUpload = z.object({
  events: z.array(journalClientEvent).min(1).max(50),
});
export type JournalClientEvent = z.infer<typeof journalClientEvent>;
export interface TraceEvent {
  kind: "catalog" | "provider" | "tool" | "policy";
  name?: string | undefined;
  callId?: string;
  round?: number;
  status: "ok" | "partial" | "error";
  durationMs?: number;
  httpStatus?: number | undefined;
  input?: unknown;
  output?: unknown;
}
export type TraceObserver = (event: TraceEvent) => void;
