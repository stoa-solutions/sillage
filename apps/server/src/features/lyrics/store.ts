import { and, eq, sql } from "drizzle-orm";
import {
  lyrics,
  lyricsOffsets,
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
