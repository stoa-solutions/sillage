import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
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
import { timestamptz, tsvector } from "./columns.ts";
import { users } from "./accounts.ts";

export const playlistStatus = pgEnum("playlist_status", [
  "pending",
  "syncing",
  "ready",
  "error",
]);
export const syncRunStatus = pgEnum("sync_run_status", [
  "running",
  "done",
  "error",
]);

/** A YouTube playlist. The catalogue is shared between accounts; ownership is userPlaylists. */
export const playlists = pgTable("playlists", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  lastSyncAt: timestamptz("last_sync_at"),
  nextSyncAt: timestamptz("next_sync_at").notNull().defaultNow(),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  generation: bigint("generation", { mode: "number" }).notNull().default(0),
  status: playlistStatus("status").notNull().default("pending"),
  error: text("error"),
});

export const userPlaylists = pgTable(
  "user_playlists",
  {
    userId: uuid("user_id").notNull(),
    playlistId: text("playlist_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "user_playlists_pkey",
      columns: [t.userId, t.playlistId],
    }),
    foreignKey({
      name: "user_playlists_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "user_playlists_playlist_id_fkey",
      columns: [t.playlistId],
      foreignColumns: [playlists.id],
    }).onDelete("cascade"),
  ],
);

/** A public YouTube video and the state of its indexes. */
export const videos = pgTable(
  "videos",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    channel: text("channel"),
    durationSeconds: doublePrecision("duration_seconds"),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    publishedAt: text("published_at"),
    thumbnailUrl: text("thumbnail_url").notNull(),
    /** Hash of the indexed text; ":<metadata hash>" is appended by sillage_music_revision(). */
    contentHash: text("content_hash").notNull(),
    indexHash: text("index_hash"),
    enrichedAt: timestamptz("enriched_at"),
    available: boolean("available").notNull().default(true),
    imageHash: text("image_hash"),
    imageCheckedAt: timestamptz("image_checked_at"),
    imageError: text("image_error"),
    searchDocument: tsvector("search_document").generatedAlwaysAs(
      sql`setweight(to_tsvector('sillage_simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('sillage_simple', coalesce(channel,'')), 'A') ||
    setweight(to_tsvector('sillage_simple', tags::text), 'B') ||
    setweight(to_tsvector('sillage_simple', description), 'C')`,
    ),
    channelId: text("channel_id"),
    musicMetadata: jsonb("music_metadata"),
    musicSearchDocument: tsvector("music_search_document").generatedAlwaysAs(
      sql`to_tsvector('sillage_simple',coalesce(music_metadata->>'searchText',''))`,
    ),
  },
  (t) => [
    index("videos_lexical").using("gin", t.searchDocument),
    index("videos_music_lexical").using("gin", t.musicSearchDocument),
  ],
);

/** A video's place in a playlist; kept inactive when it disappears from YouTube. */
export const memberships = pgTable(
  "memberships",
  {
    key: text("key").primaryKey(),
    playlistId: text("playlist_id").notNull(),
    videoId: text("video_id").notNull(),
    position: integer("position").notNull(),
    addedAt: timestamptz("added_at"),
    seenGeneration: bigint("seen_generation", { mode: "number" }).notNull(),
    missingCount: integer("missing_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: "memberships_playlist_id_fkey",
      columns: [t.playlistId],
      foreignColumns: [playlists.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "memberships_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }),
    index("memberships_playlist").on(t.playlistId, t.active, t.position),
    index("memberships_video").on(t.videoId, t.active),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey(),
    playlistId: text("playlist_id").notNull(),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
    status: syncRunStatus("status").notNull().default("running"),
    entries: integer("entries"),
    error: text("error"),
  },
  (t) => [
    foreignKey({
      name: "sync_runs_playlist_id_fkey",
      columns: [t.playlistId],
      foreignColumns: [playlists.id],
    }),
  ],
);

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  avatarUrl: text("avatar_url"),
  fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
});

export const musicbrainzCache = pgTable("musicbrainz_cache", {
  url: text("url").primaryKey(),
  response: jsonb("response").notNull(),
  fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
});

/** Artist pages and video reactions gathered from public sources, shared by every account. */
export const insightsCache = pgTable("insights_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
});
