import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";
import { users } from "./accounts.ts";

const scopes = sql.raw(
  "ARRAY['library'::text, 'youtube'::text, 'all'::text]",
);

/** Private DJ diagnostics: conversations, turns and their journal. */
export const djConversations = pgTable(
  "dj_conversations",
  {
    userId: uuid("user_id").notNull(),
    id: uuid("id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "dj_conversations_pkey", columns: [t.userId, t.id] }),
    foreignKey({
      name: "dj_conversations_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    index("dj_conversations_recent").on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

export const djTurns = pgTable(
  "dj_turns",
  {
    id: uuid("id").notNull(),
    userId: uuid("user_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    installationId: uuid("installation_id"),
    requestId: uuid("request_id"),
    scope: text("scope").notNull(),
    requestedScope: text("requested_scope"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    input: jsonb("input").notNull(),
    plan: jsonb("plan").notNull(),
    response: jsonb("response"),
    model: text("model"),
    promptHash: text("prompt_hash").notNull(),
    releaseSha: text("release_sha").notNull(),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    completedAt: timestamptz("completed_at"),
    journalComplete: boolean("journal_complete").notNull().default(false),
  },
  (t) => [
    primaryKey({ name: "dj_turns_pkey", columns: [t.userId, t.id] }),
    foreignKey({
      name: "dj_turns_user_id_conversation_id_fkey",
      columns: [t.userId, t.conversationId],
      foreignColumns: [djConversations.userId, djConversations.id],
    }).onDelete("cascade"),
    check("dj_turns_scope_check", sql`${t.scope} = ANY (${scopes})`),
    check(
      "dj_turns_requested_scope_check",
      sql`${t.requestedScope} = ANY (${scopes})`,
    ),
    check(
      "dj_turns_trigger_check",
      sql`${t.trigger} = ANY (ARRAY['user'::text, 'continuation'::text])`,
    ),
    check(
      "dj_turns_status_check",
      sql`${t.status} = ANY (ARRAY['running'::text, 'completed'::text, 'error'::text, 'canceled'::text, 'busy'::text, 'superseded'::text, 'interrupted'::text])`,
    ),
    index("dj_turns_conversation").on(
      t.userId,
      t.conversationId,
      t.startedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("dj_turns_request")
      .on(t.userId, t.requestId)
      .where(sql`request_id IS NOT NULL`),
  ],
);

export const djJournalEvents = pgTable(
  "dj_journal_events",
  {
    sequence: bigint("sequence", { mode: "number" })
      .notNull()
      .generatedAlwaysAsIdentity(),
    userId: uuid("user_id").notNull(),
    id: uuid("id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id"),
    scope: text("scope").notNull(),
    origin: text("origin").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    clientSequence: integer("client_sequence"),
    occurredAt: timestamptz("occurred_at"),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "dj_journal_events_pkey", columns: [t.userId, t.id] }),
    foreignKey({
      name: "dj_journal_events_user_id_conversation_id_fkey",
      columns: [t.userId, t.conversationId],
      foreignColumns: [djConversations.userId, djConversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dj_journal_events_user_id_turn_id_fkey",
      columns: [t.userId, t.turnId],
      foreignColumns: [djTurns.userId, djTurns.id],
    }).onDelete("cascade"),
    check("dj_journal_events_scope_check", sql`${t.scope} = ANY (${scopes})`),
    check(
      "dj_journal_events_origin_check",
      sql`${t.origin} = ANY (ARRAY['client'::text, 'server'::text])`,
    ),
    index("dj_journal_conversation").on(t.userId, t.conversationId, t.sequence),
    index("dj_journal_turn")
      .on(t.userId, t.turnId, t.sequence)
      .where(sql`turn_id IS NOT NULL`),
  ],
);
