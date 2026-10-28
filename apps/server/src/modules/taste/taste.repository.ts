import { and, eq, inArray, sql } from "drizzle-orm";
import {
  listeningHistory,
  tasteSettings,
  trackFeedback,
  videos,
  type Orm,
} from "../../db/index.ts";
import type { TasteValue, TrackSignals } from "./taste.rules.ts";

/** Everything known about these tracks for one listener, in two queries. */
export async function signalsFor(
  orm: Orm,
  owner: string,
  videoIds: readonly string[],
  thresholds: { listenMs: number; earlySkipMs: number },
): Promise<Map<string, TrackSignals>> {
  const signals = new Map<string, TrackSignals>();
  if (!videoIds.length) return signals;
  const ids = [...new Set(videoIds)];
  const { outcome, listenedMs } = listeningHistory;
  const plays = await orm
    .select({
      videoId: listeningHistory.videoId,
      // Old plays have no listening time: they count only when finished.
      listens: sql<number>`count(*) FILTER (WHERE ${outcome} = 'finished' OR (${outcome} IN ('skipped', 'replaced') AND ${listenedMs} >= ${thresholds.listenMs}))::int`,
      earlySkips: sql<number>`count(*) FILTER (WHERE ${outcome} = 'skipped' AND ${listenedMs} < ${thresholds.earlySkipMs})::int`,
    })
    .from(listeningHistory)
    .where(and(eq(listeningHistory.userId, owner), inArray(listeningHistory.videoId, ids)))
    .groupBy(listeningHistory.videoId);
  for (const row of plays)
    if (row.listens || row.earlySkips)
      signals.set(row.videoId, { listens: row.listens, earlySkips: row.earlySkips });
  const opinions = await orm
    .select({
      videoId: trackFeedback.videoId,
      value: trackFeedback.value,
      at: trackFeedback.updatedAt,
    })
    .from(trackFeedback)
    .where(and(eq(trackFeedback.userId, owner), inArray(trackFeedback.videoId, ids)));
  for (const row of opinions)
    signals.set(row.videoId, {
      ...(signals.get(row.videoId) ?? { listens: 0, earlySkips: 0 }),
      feedback: { value: row.value, at: row.at },
    });
  return signals;
}

/**
 * Every track this listener played or gave an opinion on, with what the catalogue knows of
 * it. A track played from YouTube without being saved keeps the title its last play recorded.
 */
export async function heardTracks(orm: Orm, owner: string) {
  const heard = sql`(
    SELECT video_id FROM ${listeningHistory} WHERE user_id = ${owner}
    UNION SELECT video_id FROM ${trackFeedback} WHERE user_id = ${owner}
  )`;
  const rows = await orm.execute<{
    id: string;
    title: string | null;
    channel: string | null;
    duration_seconds: number | null;
    music_metadata: unknown;
  }>(sql`
    SELECT h.video_id AS id,
      coalesce(v.title, last.title) AS title,
      coalesce(v.channel, last.channel) AS channel,
      v.duration_seconds, v.music_metadata
    FROM ${heard} h(video_id)
    LEFT JOIN ${videos} v ON v.id = h.video_id
    LEFT JOIN LATERAL (
      SELECT title, channel FROM ${listeningHistory}
      WHERE user_id = ${owner} AND video_id = h.video_id
      ORDER BY played_at DESC LIMIT 1
    ) last ON true`);
  return rows.rows;
}

export async function feedbackOf(orm: Orm, owner: string, videoId: string) {
  const [row] = await orm
    .select({ value: trackFeedback.value })
    .from(trackFeedback)
    .where(and(eq(trackFeedback.userId, owner), eq(trackFeedback.videoId, videoId)));
  return row?.value ?? null;
}

/** A new opinion replaces the previous one and restarts its clock; null withdraws it. */
export async function saveFeedback(
  orm: Orm,
  owner: string,
  videoId: string,
  value: TasteValue | null,
) {
  if (!value) {
    await orm
      .delete(trackFeedback)
      .where(and(eq(trackFeedback.userId, owner), eq(trackFeedback.videoId, videoId)));
    return;
  }
  await orm
    .insert(trackFeedback)
    .values({ userId: owner, videoId, value })
    .onConflictDoUpdate({
      target: [trackFeedback.userId, trackFeedback.videoId],
      set: { value, updatedAt: sql`now()` },
    });
}

export async function storedDislikeDays(orm: Orm, owner: string) {
  const [row] = await orm
    .select({ days: tasteSettings.dislikeDays })
    .from(tasteSettings)
    .where(eq(tasteSettings.userId, owner));
  return row?.days;
}

export async function saveDislikeDays(orm: Orm, owner: string, days: number) {
  await orm
    .insert(tasteSettings)
    .values({ userId: owner, dislikeDays: days })
    .onConflictDoUpdate({
      target: tasteSettings.userId,
      set: { dislikeDays: days, updatedAt: sql`now()` },
    });
}
