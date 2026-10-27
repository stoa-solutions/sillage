import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { LibraryImport, Video } from "@playlist-recall/core/types";
import { documentText, hash } from "../../content.ts";
import {
  LEGACY_USER_ID,
  channels,
  images,
  jobs,
  memberships,
  playlists,
  userPlaylists,
  videos,
  type Executor,
} from "../../db/index.ts";

/** The account follows this playlist. Every library read is filtered by it. */
export const followedBy = (db: Executor, userId: string, playlistId: SQLWrapper) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(userPlaylists)
      .where(
        and(
          eq(userPlaylists.userId, userId),
          eq(userPlaylists.playlistId, playlistId),
        ),
      ),
  );

/** The video is active in one of the account's playlists. */
export const inLibraryOf = (db: Executor, userId: string, videoId: SQLWrapper) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(memberships)
      .innerJoin(
        userPlaylists,
        eq(userPlaylists.playlistId, memberships.playlistId),
      )
      .where(
        and(
          eq(memberships.videoId, videoId),
          eq(memberships.active, true),
          eq(userPlaylists.userId, userId),
        ),
      ),
  );

/** The account's playlists, with their number of active entries. */
export async function listPlaylists(db: Executor, userId: string) {
  const entries = db
    .select({ count: count() })
    .from(memberships)
    .where(
      and(eq(memberships.playlistId, playlists.id), eq(memberships.active, true)),
    );
  return db
    .select({
      playlist: playlists,
      entries: sql<number>`(${entries})::int`,
    })
    .from(playlists)
    .where(followedBy(db, userId, playlists.id))
    .orderBy(asc(playlists.createdAt));
}

/** Follows a YouTube playlist; its content arrives with the next synchronisation. */
export async function followPlaylist(db: Executor, userId: string, id: string) {
  await db
    .insert(playlists)
    .values({
      id,
      title: "Nouvelle playlist",
      sourceUrl: `https://www.youtube.com/playlist?list=${id}`,
    })
    .onConflictDoNothing({ target: playlists.id });
  await db
    .insert(userPlaylists)
    .values({ userId, playlistId: id })
    .onConflictDoNothing();
}

export async function followsPlaylist(db: Executor, userId: string, id: string) {
  const [link] = await db
    .select({ id: userPlaylists.playlistId })
    .from(userPlaylists)
    .where(
      and(eq(userPlaylists.userId, userId), eq(userPlaylists.playlistId, id)),
    );
  return Boolean(link);
}

/** The private "Mes découvertes" playlist of an account. */
export const discoveriesId = (userId: string) => `recall-discoveries:${userId}`;

/**
 * Removes the playlist from this account only: YouTube and other accounts keep it, and its
 * videos leave the library unless another of the account's playlists holds them.
 */
export async function unfollowPlaylist(db: Executor, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(userPlaylists)
      .where(
        and(eq(userPlaylists.playlistId, id), eq(userPlaylists.userId, userId)),
      )
      .returning({ id: userPlaylists.playlistId });
    // Mes découvertes belongs to this account alone: emptied, so a later addition starts
    // afresh. The row lock serialises with a concurrent discovery addition.
    if (removed.length && id === discoveriesId(userId)) {
      await tx
        .select({ id: playlists.id })
        .from(playlists)
        .where(eq(playlists.id, id))
        .for("update");
      await tx
        .update(memberships)
        .set({ active: false })
        .where(eq(memberships.playlistId, id));
    }
    return removed.length > 0;
  });
}

/** Counters of /v1/status: videos, text and image indexes, and the account's visible jobs. */
export async function libraryStatus(db: Executor, userId: string) {
  const owned = inLibraryOf(db, userId, videos.id);
  const [counts] = await db
    .select({
      videos: count(),
      titled: count(videos.title),
      descriptions: sql<number>`count(*) FILTER (WHERE ${ne(videos.description, "")})::int`,
      text_indexed: sql<number>`count(*) FILTER (WHERE ${eq(videos.indexHash, videos.contentHash)})::int`,
    })
    .from(videos)
    .where(owned);
  const [indexedImages] = await db
    .select({ count: count() })
    .from(images)
    .innerJoin(videos, eq(videos.id, images.videoId))
    .where(
      and(
        eq(images.sourceUrl, videos.thumbnailUrl),
        inLibraryOf(db, userId, images.videoId),
      ),
    );
  const newer = alias(jobs, "newer");
  const visibleJobs = await db
    .select({ kind: jobs.kind, status: jobs.status, count: count() })
    .from(jobs)
    .where(
      and(
        or(
          followedBy(db, userId, sql`${jobs.payload}->>'playlistId'`),
          inLibraryOf(db, userId, sql`${jobs.payload}->>'videoId'`),
        ),
        // A failed job stays visible until a newer attempt of the same key replaces it.
        or(
          inArray(jobs.status, ["pending", "running"]),
          and(
            eq(jobs.status, "failed"),
            notExists(
              db
                .select({ one: sql`1` })
                .from(newer)
                .where(
                  and(
                    eq(newer.dedupeKey, jobs.dedupeKey),
                    gt(newer.createdAt, jobs.createdAt),
                  ),
                ),
            ),
          ),
        ),
      ),
    )
    .groupBy(jobs.kind, jobs.status);
  return {
    counts: {
      videos: counts?.videos ?? 0,
      titled: counts?.titled ?? 0,
      descriptions: counts?.descriptions ?? 0,
      text_indexed: counts?.text_indexed ?? 0,
      images: indexedImages?.count ?? 0,
    },
    jobs: visibleJobs,
  };
}

/** Everything the account can export, in the shared core's import model. */
export async function libraryOf(
  db: Executor,
  userId: string,
): Promise<LibraryImport> {
  const ownedPlaylists = await db
    .select()
    .from(playlists)
    .where(followedBy(db, userId, playlists.id));
  const ownedVideos = await db
    .select()
    .from(videos)
    .where(inLibraryOf(db, userId, videos.id));
  const activeEntries = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.active, true),
        followedBy(db, userId, memberships.playlistId),
      ),
    );
  return {
    playlists: ownedPlaylists.map((p) => ({
      id: p.id,
      title: p.title,
      sourceUrl: p.sourceUrl,
      importedAt: p.createdAt.toISOString(),
    })),
    videos: ownedVideos.map(videoFromRecord),
    memberships: activeEntries.map((m) => ({
      key: m.key,
      playlistId: m.playlistId,
      videoId: m.videoId,
      position: m.position,
    })),
  };
}

export function videoFromRecord(row: typeof videos.$inferSelect): Video {
  return {
    id: row.id,
    musicMetadata: (row.musicMetadata as Video["musicMetadata"]) ?? null,
    title: row.title,
    channel: row.channel,
    durationSeconds: row.durationSeconds,
    description: row.description,
    tags: row.tags,
    publishedAt: row.publishedAt,
    thumbnailUrl: row.thumbnailUrl,
    url: `https://www.youtube.com/watch?v=${row.id}`,
  };
}

/** Maps a raw SQL row of videos, for the modules still written in SQL. */
export function videoFromRow(row: Record<string, unknown>): Video {
  return {
    id: row["id"] as string,
    musicMetadata: (row["music_metadata"] as Video["musicMetadata"]) ?? null,
    title: row["title"] as string | null,
    channel: row["channel"] as string | null,
    durationSeconds: row["duration_seconds"] as number | null,
    description: row["description"] as string,
    tags: row["tags"] as string[],
    publishedAt: row["published_at"] as string | null,
    thumbnailUrl: row["thumbnail_url"] as string,
    url: `https://www.youtube.com/watch?v=${row["id"]}`,
  };
}

const excluded = (column: string): SQL => sql.raw(`excluded.${column}`);

/**
 * Creates or refreshes a video from YouTube metadata. `enriched` marks a full API answer, as
 * opposed to the title-only placeholder of a playlist entry. A video seen again is available.
 */
export async function upsertVideo(
  db: Executor,
  v: Video & { channelId?: string | null },
  enriched = false,
) {
  await db
    .insert(videos)
    .values({
      id: v.id,
      title: v.title,
      channel: v.channel,
      durationSeconds: v.durationSeconds,
      description: v.description,
      tags: v.tags,
      publishedAt: v.publishedAt,
      thumbnailUrl: v.thumbnailUrl,
      contentHash: hash(documentText(v)),
      enrichedAt: enriched ? sql`now()` : null,
      channelId: v.channelId ?? null,
    })
    .onConflictDoUpdate({
      target: videos.id,
      set: {
        title: excluded("title"),
        channel: excluded("channel"),
        durationSeconds: excluded("duration_seconds"),
        description: excluded("description"),
        tags: excluded("tags"),
        publishedAt: excluded("published_at"),
        thumbnailUrl: excluded("thumbnail_url"),
        contentHash: excluded("content_hash"),
        enrichedAt: enriched ? sql`now()` : sql`${videos.enrichedAt}`,
        available: true,
        channelId: sql`COALESCE(excluded.channel_id, ${videos.channelId})`,
      },
    });
}

/**
 * Historical maintenance import into the legacy account: playlists, videos not yet enriched by
 * YouTube, and memberships of playlists never synchronised. All or nothing.
 */
export async function importIntoLegacyLibrary(
  db: Executor,
  library: LibraryImport,
) {
  await db.transaction(async (tx) => {
    for (const p of library.playlists) {
      await tx
        .insert(playlists)
        .values({ id: p.id, title: p.title, sourceUrl: p.sourceUrl })
        .onConflictDoNothing({ target: playlists.id });
      await tx
        .insert(userPlaylists)
        .values({ userId: LEGACY_USER_ID, playlistId: p.id })
        .onConflictDoNothing();
    }
    for (const v of library.videos) {
      const [enriched] = await tx
        .select({ id: videos.id })
        .from(videos)
        .where(and(eq(videos.id, v.id), isNotNull(videos.enrichedAt)));
      if (!enriched) await upsertVideo(tx, v);
    }
    for (const m of library.memberships) {
      // A synchronised playlist (generation > 0) has its real YouTube entries already.
      const [fresh] = await tx
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, m.playlistId), eq(playlists.generation, 0)));
      if (!fresh) continue;
      await tx
        .insert(memberships)
        .values({
          key: `seed:${m.key}`,
          playlistId: m.playlistId,
          videoId: m.videoId,
          position: m.position,
          seenGeneration: 0,
        })
        .onConflictDoNothing({ target: memberships.key });
    }
  });
}

/** Full YouTube metadata; a video YouTube no longer returns stays, marked unavailable. */
export async function saveEnrichedVideos(
  db: Executor,
  found: (Video & { channelId?: string | null })[],
  missing: string[],
) {
  await db.transaction(async (tx) => {
    for (const v of found) await upsertVideo(tx, v, true);
    if (missing.length)
      await tx
        .update(videos)
        .set({ available: false, enrichedAt: sql`now()` })
        .where(inArray(videos.id, missing));
  });
}

/** Channels whose photo was fetched within 30 days. */
export async function freshChannelIds(db: Executor, ids: string[]) {
  const fresh = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        inArray(channels.id, ids),
        gt(channels.fetchedAt, sql`now() - interval '30 days'`),
      ),
    );
  return new Set(fresh.map((row) => row.id));
}

/** A missing photo keeps the previous one. */
export async function saveChannelAvatar(
  db: Executor,
  id: string,
  avatarUrl: string | null,
) {
  await db
    .insert(channels)
    .values({ id, avatarUrl, fetchedAt: sql`now()` })
    .onConflictDoUpdate({
      target: channels.id,
      set: {
        avatarUrl: sql`COALESCE(excluded.avatar_url, ${channels.avatarUrl})`,
        fetchedAt: sql`now()`,
      },
    });
}

/** Playlists due for their periodic synchronisation and still followed by some account. */
export async function playlistsDueForSync(db: Executor) {
  const due = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(
      and(
        eq(playlists.syncEnabled, true),
        lte(playlists.nextSyncAt, sql`now()`),
        exists(
          db
            .select({ one: sql`1` })
            .from(userPlaylists)
            .where(eq(userPlaylists.playlistId, playlists.id)),
        ),
      ),
    );
  return due.map((row) => row.id);
}

export async function postponeSync(db: Executor, id: string) {
  await db
    .update(playlists)
    .set({ nextSyncAt: sql`now() + interval '6 hours'` })
    .where(eq(playlists.id, id));
}
