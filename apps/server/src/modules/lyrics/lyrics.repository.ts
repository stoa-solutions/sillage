import { and, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import {
  lyrics,
  lyricsOffsets,
  memberships,
  videos,
  type Executor,
} from "../../db/index.ts";
import type { LyricsLine } from "../../integrations/lrclib/index.ts";
import { inLibraryOf } from "../library/index.ts";

/** Title, channel and duration of a video, only when it is in the account's library. */
export async function ownedVideo(db: Executor, userId: string, videoId: string) {
  const [video] = await db
    .select({
      title: videos.title,
      channel: videos.channel,
      durationSeconds: videos.durationSeconds,
    })
    .from(videos)
    .where(and(eq(videos.id, videoId), inLibraryOf(db, userId, videos.id)));
  return video ?? null;
}

/** What the server knows of any video, in a library or not; null when it never saw it. */
export async function videoFacts(db: Executor, videoId: string) {
  const [video] = await db
    .select({
      title: videos.title,
      channel: videos.channel,
      durationSeconds: videos.durationSeconds,
      musicMetadata: videos.musicMetadata,
    })
    .from(videos)
    .where(eq(videos.id, videoId));
  return video ?? null;
}

/**
 * Library videos whose lyrics were never looked for, then misses older than `missingDays`:
 * the worker fetches them ahead, so a song opens with its lyrics.
 */
export async function lyricsBacklog(db: Executor, limit: number, missingDays: number) {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      channel: videos.channel,
      durationSeconds: videos.durationSeconds,
      musicMetadata: videos.musicMetadata,
    })
    .from(videos)
    .leftJoin(lyrics, eq(lyrics.videoId, videos.id))
    .where(
      and(
        exists(
          db
            .select({ one: sql`1` })
            .from(memberships)
            .where(and(eq(memberships.videoId, videos.id), eq(memberships.active, true))),
        ),
        or(
          isNull(lyrics.videoId),
          and(
            eq(lyrics.status, "missing"),
            lt(lyrics.fetchedAt, sql`now() - make_interval(days => ${missingDays}::int)`),
          ),
        ),
      ),
    )
    .orderBy(sql`${lyrics.videoId} IS NOT NULL`, videos.id)
    .limit(limit);
}

export async function lyricsOffset(db: Executor, userId: string, videoId: string) {
  const [row] = await db
    .select({ offsetMs: lyricsOffsets.offsetMs })
    .from(lyricsOffsets)
    .where(
      and(eq(lyricsOffsets.userId, userId), eq(lyricsOffsets.videoId, videoId)),
    );
  return row?.offsetMs ?? 0;
}

/** Cached lyrics, with whether they are still fresh: a miss is retried sooner than a hit. */
export async function cachedLyrics(
  db: Executor,
  videoId: string,
  freshness: { foundDays: number; missingDays: number },
) {
  const [row] = await db
    .select({
      status: lyrics.status,
      sourceId: lyrics.sourceId,
      sourceName: lyrics.sourceName,
      lines: lyrics.lines,
      plainText: lyrics.plainText,
      durationDeltaMs: lyrics.durationDeltaMs,
      fresh: sql<boolean>`${lyrics.fetchedAt} > now() - make_interval(days => CASE WHEN ${lyrics.status} = 'missing' THEN ${freshness.missingDays}::int ELSE ${freshness.foundDays}::int END)`,
    })
    .from(lyrics)
    .where(eq(lyrics.videoId, videoId));
  return row ? { ...row, lines: row.lines as LyricsLine[] } : null;
}

export async function saveLyrics(
  db: Executor,
  record: {
    videoId: string;
    status: (typeof lyrics.$inferInsert)["status"];
    sourceId: number | null;
    sourceName: string | null;
    lines: LyricsLine[];
    plainText: string | null;
    durationDeltaMs: number | null;
  },
) {
  const { videoId, ...fields } = record;
  await db
    .insert(lyrics)
    .values({ videoId, ...fields, fetchedAt: sql`now()` })
    .onConflictDoUpdate({
      target: lyrics.videoId,
      set: { ...fields, fetchedAt: sql`now()` },
    });
}

/** Zero removes the correction. */
export async function saveLyricsOffset(
  db: Executor,
  userId: string,
  videoId: string,
  offsetMs: number,
) {
  if (offsetMs === 0) {
    await db
      .delete(lyricsOffsets)
      .where(
        and(eq(lyricsOffsets.userId, userId), eq(lyricsOffsets.videoId, videoId)),
      );
    return;
  }
  await db
    .insert(lyricsOffsets)
    .values({ userId, videoId, offsetMs, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [lyricsOffsets.userId, lyricsOffsets.videoId],
      set: { offsetMs, updatedAt: sql`now()` },
    });
}
