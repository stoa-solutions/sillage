import { and, eq, inArray, sql } from "drizzle-orm";
import {
  listeningHistory,
  memberships,
  tasteSettings,
  trackFeedback,
  userPlaylists,
  videos,
  type Orm,
} from "../../../db/index.ts";
import { TASTE_RULES, type TasteValue, type TrackSignals } from "../taste.rules.ts";

export interface SignalThresholds {
  listenMs: number;
  earlySkipMs: number;
  /** Half-lives in days for listens and early skips (see TASTE_RULES.halfLifeDays). */
  listenHalfLifeDays: number;
  earlySkipHalfLifeDays: number;
}

/** A play that counts as a listen: finished, or stopped after `listenMs`. Old plays without a time only count when finished. */
export const isListen = (listenMs: number = TASTE_RULES.listenMs) =>
  sql`${listeningHistory.outcome} = 'finished' OR (${listeningHistory.outcome} IN ('skipped', 'replaced') AND ${listeningHistory.listenedMs} >= ${listenMs})`;

/** A play given up before `earlySkipMs`, whether skipped or replaced by another request. */
const isEarlySkip = (earlySkipMs: number) =>
  sql`${listeningHistory.outcome} IN ('skipped', 'replaced') AND ${listeningHistory.listenedMs} < ${earlySkipMs}`;

/** Everything known about these tracks for one listener, in three queries, as of `now`. */
export async function signalsFor(
  orm: Orm,
  owner: string,
  videoIds: readonly string[],
  thresholds: SignalThresholds,
  now: Date = new Date(),
): Promise<Map<string, TrackSignals>> {
  const signals = new Map<string, TrackSignals>();
  if (!videoIds.length) return signals;
  const ids = [...new Set(videoIds)];
  const at = sql`${now.toISOString()}::timestamptz`;
  // 0.5 ^ (age in days / half-life): each play weighs less as it ages.
  const aged = (halfLifeDays: number) =>
    sql`0.5 ^ (greatest(extract(epoch FROM (${at} - ${listeningHistory.playedAt})), 0) / 86400.0 / ${halfLifeDays})`;
  const listen = isListen(thresholds.listenMs);
  const earlySkip = isEarlySkip(thresholds.earlySkipMs);
  const plays = await orm
    .select({
      videoId: listeningHistory.videoId,
      listens: sql<number>`count(*) FILTER (WHERE ${listen})::int`,
      earlySkips: sql<number>`count(*) FILTER (WHERE ${earlySkip})::int`,
      recentListens: sql<number>`coalesce(sum(${aged(thresholds.listenHalfLifeDays)}) FILTER (WHERE ${listen}), 0)::float8`,
      recentEarlySkips: sql<number>`coalesce(sum(${aged(thresholds.earlySkipHalfLifeDays)}) FILTER (WHERE ${earlySkip}), 0)::float8`,
    })
    .from(listeningHistory)
    .where(and(eq(listeningHistory.userId, owner), inArray(listeningHistory.videoId, ids)))
    .groupBy(listeningHistory.videoId);
  for (const row of plays)
    if (row.listens || row.earlySkips)
      signals.set(row.videoId, {
        listens: row.listens,
        earlySkips: row.earlySkips,
        recentListens: Number(row.recentListens),
        recentEarlySkips: Number(row.recentEarlySkips),
      });
  // When the listener first added the track to one of their playlists (YouTube's date).
  const added = await orm
    .select({ videoId: memberships.videoId, addedAt: sql<Date | null>`min(${memberships.addedAt})` })
    .from(memberships)
    .innerJoin(userPlaylists, eq(userPlaylists.playlistId, memberships.playlistId))
    .where(
      and(
        eq(userPlaylists.userId, owner),
        eq(memberships.active, true),
        inArray(memberships.videoId, ids),
      ),
    )
    .groupBy(memberships.videoId);
  for (const row of added)
    if (row.addedAt)
      signals.set(row.videoId, {
        ...(signals.get(row.videoId) ?? { listens: 0, earlySkips: 0 }),
        addedAt: new Date(row.addedAt),
      });
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

/**
 * What a Discover page depends on besides plays: opinions and playlist contents. A changed
 * stamp means the page's taste is stale.
 */
export async function tasteStamp(orm: Orm, owner: string) {
  const [opinions] = await orm
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${trackFeedback.updatedAt})::text`,
    })
    .from(trackFeedback)
    .where(eq(trackFeedback.userId, owner));
  const [saved] = await orm
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(userPlaylists, eq(userPlaylists.playlistId, memberships.playlistId))
    .where(and(eq(userPlaylists.userId, owner), eq(memberships.active, true)));
  return `${opinions?.count ?? 0}:${opinions?.latest ?? ""}:${saved?.count ?? 0}`;
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
