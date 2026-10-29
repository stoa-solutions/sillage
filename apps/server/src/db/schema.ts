// The whole PostgreSQL database in one file, read top to bottom like a schema.prisma.
// drizzle-kit diffs this file against drizzle/meta to write migrations (npm run db:generate).
// Sections: accounts, library, search, jobs, listening, dj, taste, legacy.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ─── Column helpers ────────────────────────────────────────────────────────────────────────

/** timestamptz read as a Date. */
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** PostgreSQL full-text document; only ever produced by generated columns. */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// ─── Accounts: users, sessions, OAuth, AI keys and DJ usage ────────────────────────────────

export const aiProvider = pgEnum("ai_provider", ["google", "anthropic"]);
export const userDjProvider = pgEnum("user_dj_provider", ["google", "anthropic"]);

/** A Google account. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    googleSub: text("google_sub").unique("users_google_sub_key"),
    email: text("email"),
    name: text("name"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    djProvider: userDjProvider("dj_provider").notNull().default("google"),
  },
);

/** One signed-in installation. Only the SHA-256 of its bearer token is stored. */
export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    hash: text("hash").notNull().unique("tokens_hash_key"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    userId: uuid("user_id").notNull(),
    /** Null for personal tokens made by the CLI: they never expire, they are revoked. */
    expiresAt: timestamptz("expires_at"),
  },
  (t) => [
    foreignKey({
      name: "tokens_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    index("tokens_user").on(t.userId),
  ],
);

/** A Google sign-in in progress (10 minutes), bound to the browser by a cookie. */
export const oauthFlows = pgTable("oauth_flows", {
  stateHash: text("state_hash").primaryKey(),
  cookieHash: text("cookie_hash").notNull(),
  /** PKCE S256 challenge of the native app. */
  challenge: text("challenge").notNull(),
  appState: text("app_state").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
});

/** The one-time code handed back to the app (90 seconds), traded with the PKCE verifier. */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: uuid("user_id").notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "oauth_grants_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

/** A personal AI key per provider, AES-256-GCM encrypted with the user id as AAD. */
export const accountAiCredentials = pgTable(
  "account_ai_credentials",
  {
    userId: uuid("user_id").notNull(),
    provider: aiProvider("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "account_ai_credentials_pkey",
      columns: [t.userId, t.provider],
    }),
    foreignKey({
      name: "account_ai_credentials_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

/** Google mirror of accountAiCredentials, kept so an older server can still run. */
export const accountDjSettings = pgTable(
  "account_dj_settings",
  {
    userId: uuid("user_id").primaryKey(),
    encryptedKey: text("encrypted_key").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "account_dj_settings_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const accountDjUsage = pgTable(
  "account_dj_usage",
  {
    userId: uuid("user_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "account_dj_usage_pkey", columns: [t.userId, t.day] }),
    foreignKey({
      name: "account_dj_usage_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

// ─── Library: playlists, videos, memberships, sync runs, caches ────────────────────────────

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

// ─── Search: embedded passages and images ──────────────────────────────────────────────────

/** Text chunks of a video with their E5 embedding. */
export const passages = pgTable(
  "passages",
  {
    videoId: text("video_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    sourceHash: text("source_hash").notNull(),
    modelKey: text("model_key").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
  },
  (t) => [
    primaryKey({ name: "passages_pkey", columns: [t.videoId, t.ordinal] }),
    foreignKey({
      name: "passages_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);

/** Thumbnail embedding of a video. */
export const images = pgTable(
  "images",
  {
    videoId: text("video_id").primaryKey(),
    sourceHash: text("source_hash").notNull(),
    sourceUrl: text("source_url").notNull(),
    modelKey: text("model_key").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    indexedAt: timestamptz("indexed_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "images_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);

// ─── Jobs: the worker queue and YouTube quota ──────────────────────────────────────────────

export const jobKind = pgEnum("job_kind", [
  "sync",
  "enrich",
  "text",
  "image",
  "musicbrainz",
]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

/** Worker queue leased with row locks: at most one pending or running job per dedupe key. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    kind: jobKind("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamptz("available_at").notNull().defaultNow(),
    leaseUntil: timestamptz("lease_until"),
    leaseId: uuid("lease_id"),
    error: text("error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    completedAt: timestamptz("completed_at"),
  },
  (t) => [
    uniqueIndex("jobs_active_key")
      .on(t.dedupeKey)
      .where(sql`status IN ('pending','running')`),
    index("jobs_due").on(t.status, t.availableAt),
    // Bounded account progress polling must not scan historical jobs per video.
    index("jobs_musicbrainz_video")
      .on(sql`(payload->>'videoId')`, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`kind='musicbrainz'`),
  ],
);

/** YouTube Data API units spent per day. */
export const quotaUsage = pgTable("quota_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  units: integer("units").notNull().default(0),
});

// ─── Listening: history, lyrics and their offsets ──────────────────────────────────────────

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
    /** LRCLIB's record ID; other sources have none. */
    sourceId: bigint("source_id", { mode: "number" }),
    /** Where the lyrics come from, as shown to the listener (null: LRCLIB, before 0006). */
    sourceName: text("source_name"),
    lines: jsonb("lines").notNull().default([]),
    plainText: text("plain_text"),
    durationDeltaMs: integer("duration_delta_ms"),
    fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
  },
  // Public lyrics of any YouTube video, in a library or not: a played discovery has its own.
  (t) => [check("lyrics_video_id_check", sql`${t.videoId} ~ '^[A-Za-z0-9_-]{11}$'`)],
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

// ─── DJ: conversations, turns, journal, agents ─────────────────────────────────────────────

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

// ─── Taste: per-track feedback and settings ────────────────────────────────────────────────

export const tasteValue = pgEnum("taste_value", ["like", "dislike"]);

/**
 * The listener's 👍 / 👎 on a track. One row per track: a new opinion replaces the old one,
 * and withdrawing it deletes the row. No foreign key to videos: YouTube tracks may be unsaved.
 */
export const trackFeedback = pgTable(
  "track_feedback",
  {
    userId: uuid("user_id").notNull(),
    videoId: text("video_id").notNull(),
    value: tasteValue("value").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "track_feedback_pkey", columns: [t.userId, t.videoId] }),
    foreignKey({
      name: "track_feedback_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check("track_feedback_video_id_check", sql`${t.videoId} ~ '^[A-Za-z0-9_-]{11}$'`),
  ],
);

/** Per-account taste settings; an account without a row uses the defaults of taste.rules.ts. */
export const tasteSettings = pgTable(
  "taste_settings",
  {
    userId: uuid("user_id").primaryKey(),
    dislikeDays: smallint("dislike_days").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "taste_settings_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check("taste_settings_dislike_days_check", sql`${t.dislikeDays} BETWEEN 1 AND 60`),
  ],
);

// ─── Legacy: from before Drizzle ───────────────────────────────────────────────────────────

/** Versions applied by the migration script used before Drizzle; read by the 0000 baseline. */
export const schemaMigrations = pgTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: timestamptz("applied_at").notNull().defaultNow(),
});
