import { z } from "@hono/zod-openapi";
import {
  journalEventPage,
  journalPage,
  journalUpload,
} from "./journal.contracts.ts";

const uuid = z.uuid();
const date = z.iso.datetime();
const scope = z.enum(["library", "youtube", "all"]);
const status = z.enum([
  "running",
  "completed",
  "error",
  "canceled",
  "busy",
  "superseded",
  "interrupted",
]);
/** A JSON object stored as is (jsonb). */
const object = z.unknown().openapi({ type: "object", additionalProperties: true });

export const journalPageQuery = journalPage.openapi("JournalPage");
export const journalEventPageQuery = journalEventPage.openapi("JournalEventPage");
export const journalUploadBody = journalUpload.openapi("JournalUpload");
export const conversationParam = (description: string) =>
  z.object({
    conversationId: uuid.openapi({
      param: { name: "conversationId", in: "path" },
      description,
    }),
  });
export const turnParam = z.object({
  turnId: uuid.openapi({
    param: { name: "turnId", in: "path" },
    description: "UUID renvoyé dans X-Sillage-Trace-Id",
  }),
});

export const journalConversationBody = z
  .object({
    id: uuid,
    createdAt: date,
    updatedAt: date,
    turns: z.number().int(),
    messages: z.number().int(),
  })
  .openapi("JournalConversation");
export const conversationsBody = z.object({
  conversations: z.array(journalConversationBody),
  nextCursor: uuid.nullable(),
});
export const journalTurnSummaryBody = z
  .object({
    id: uuid,
    requestId: uuid.nullable(),
    scope,
    requestedScope: z.string().nullable(),
    trigger: z.enum(["user", "continuation"]),
    status,
    model: z.string().nullable(),
    startedAt: date,
    completedAt: date.nullable(),
    journalComplete: z.boolean(),
    action: z.string().nullable(),
    reply: z.string().nullable(),
    stale: z.boolean(),
  })
  .openapi("JournalTurnSummary");
export const turnsBody = z.object({
  turns: z.array(journalTurnSummaryBody),
  nextCursor: uuid.nullable(),
});
export const journalEventBody = z
  .object({
    sequence: z.string().openapi({
      description: "Curseur bigint renvoyé en chaîne, à conserver tel quel.",
    }),
    id: uuid,
    turnId: uuid.nullable(),
    scope,
    origin: z.enum(["client", "server"]),
    kind: z.string(),
    payload: object,
    clientSequence: z.number().int().nullable(),
    occurredAt: date.nullable(),
    receivedAt: date,
  })
  .openapi("JournalEvent");
export const eventsBody = z.object({
  events: z.array(journalEventBody),
  nextCursor: z.string().nullable(),
});
/** The historical SQL row of a turn: snake_case on purpose. */
export const journalTurnBody = z
  .object({
    id: uuid,
    user_id: uuid,
    conversation_id: uuid,
    installation_id: uuid.nullable(),
    request_id: uuid.nullable(),
    scope: z.string(),
    requested_scope: z.string().nullable(),
    trigger: z.string(),
    status: z.string(),
    input: z.unknown().openapi({ allOf: [{ $ref: "#/components/schemas/DjRequest" }] }),
    plan: object,
    response: object.nullable(),
    model: z.string().nullable(),
    prompt_hash: z.string(),
    release_sha: z.string(),
    started_at: date,
    completed_at: date.nullable(),
    journal_complete: z.boolean(),
  })
  .openapi("JournalTurn");
export const turnDetailBody = z.object({
  turn: journalTurnBody,
  events: z.array(
    z.object({
      sequence: z.string(),
      kind: z.string(),
      payload: object,
      receivedAt: date,
    }),
  ),
});
export const recordedBody = z.object({ recorded: z.number().int() });
export const deletedBody = z.object({ deleted: z.literal(true) });
