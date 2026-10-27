import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";
import { users } from "./accounts.ts";

export const discoveryScope = pgEnum("discovery_scope", [
  "library",
  "youtube",
  "all",
]);
export const turnTrigger = pgEnum("turn_trigger", ["user", "continuation"]);
/**
 * `superseded`: the listener forced a newer message. `busy`: a refill gave way to a typed
 * request. `interrupted`: the server stopped before the turn ended.
 */
export const turnStatus = pgEnum("turn_status", [
  "running",
  "completed",
  "error",
  "canceled",
  "busy",
  "superseded",
  "interrupted",
]);
export const journalOrigin = pgEnum("journal_origin", ["client", "server"]);

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
    scope: discoveryScope("scope").notNull(),
    requestedScope: discoveryScope("requested_scope"),
    trigger: turnTrigger("trigger").notNull(),
    status: turnStatus("status").notNull().default("running"),
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
    scope: discoveryScope("scope").notNull(),
    origin: journalOrigin("origin").notNull(),
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
    index("dj_journal_conversation").on(t.userId, t.conversationId, t.sequence),
    index("dj_journal_turn")
      .on(t.userId, t.turnId, t.sequence)
      .where(sql`turn_id IS NOT NULL`),
  ],
);

/**
 * DJ agents: a profile added to the DJ's rules, never a replacement for them. A base agent
 * (`base_key`, no owner) is written from code at every start; a custom one belongs to its account.
 */
export const djAgents = pgTable(
  "dj_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    baseKey: text("base_key").unique("dj_agents_base_key_key"),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "dj_agents_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "dj_agents_owner_check",
      sql`(${t.userId} IS NULL) <> (${t.baseKey} IS NULL)`,
    ),
    check(
      "dj_agents_size_check",
      sql`char_length(${t.name}) BETWEEN 1 AND 40 AND char_length(${t.instructions}) <= 1500`,
    ),
    index("dj_agents_user").on(t.userId, t.createdAt),
  ],
);
