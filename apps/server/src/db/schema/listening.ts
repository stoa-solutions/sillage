import { sql } from "drizzle-orm";
import {
  bigint,
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
import { videos } from "./library.ts";

export const listeningOutcome = pgEnum("listening_outcome", [
  "finished",
  "skipped",
  "unavailable",
  "replaced",
]);
/** "unavailable" is an answer of the API, never stored. */
export const lyricsStatus = pgEnum("lyrics_status", [
  "synced",
  "plain",
  "instrumental",
  "missing",
]);

export const listeningHistory = pgTable(
  "listening_history",
  {
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id").notNull(),
    videoId: text("video_id").notNull(),
    title: text("title").notNull(),
    channel: text("channel"),
    outcome: listeningOutcome("outcome").notNull(),
    /** How long the track played before this outcome; null for clients older than taste. */
    listenedMs: integer("listened_ms"),
    playedAt: timestamptz("played_at").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "listening_history_pkey",
      columns: [t.userId, t.eventId],
    }),
    foreignKey({
      name: "listening_history_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    index("listening_history_recent").on(t.userId, t.playedAt.desc().nullsFirst()),
    index("listening_history_video").on(t.userId, t.videoId),
    check(
      "listening_history_listened_ms_check",
      sql`${t.listenedMs} IS NULL OR ${t.listenedMs} >= 0`,
    ),
  ],
);

export const lyrics = pgTable(
  "lyrics",
  {
    videoId: text("video_id").primaryKey(),
    status: lyricsStatus("status").notNull(),
    sourceId: bigint("source_id", { mode: "number" }),
    lines: jsonb("lines").notNull().default([]),
    plainText: text("plain_text"),
    durationDeltaMs: integer("duration_delta_ms"),
    fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "lyrics_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);

export const lyricsOffsets = pgTable(
  "lyrics_offsets",
  {
    userId: uuid("user_id").notNull(),
    videoId: text("video_id").notNull(),
    offsetMs: integer("offset_ms").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "lyrics_offsets_pkey",
      columns: [t.userId, t.videoId],
    }),
    foreignKey({
      name: "lyrics_offsets_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lyrics_offsets_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);
