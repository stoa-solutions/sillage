import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  listeningHistory,
  tasteSettings,
  trackFeedback,
  type Orm,
} from "../../db/index.ts";
import type { TasteValue, TrackSignals } from "./taste.rules.ts";

/** Everything known about these tracks for one listener, in two queries. */
export async function signalsFor(
  orm: Orm,
  owner: string,
  videoIds: readonly string[],
  earlySkipMs: number,
): Promise<Map<string, TrackSignals>> {
  const signals = new Map<string, TrackSignals>();
  if (!videoIds.length) return signals;
  const ids = [...new Set(videoIds)];
  const plays = await orm
    .select({
      videoId: listeningHistory.videoId,
      plays: count(),
      finished: sql<number>`count(*) FILTER (WHERE ${listeningHistory.outcome} = 'finished')::int`,
      earlySkips: sql<number>`count(*) FILTER (WHERE ${listeningHistory.outcome} = 'skipped' AND ${listeningHistory.listenedMs} < ${earlySkipMs})::int`,
    })
    .from(listeningHistory)
    .where(
      and(
        eq(listeningHistory.userId, owner),
        inArray(listeningHistory.videoId, ids),
        inArray(listeningHistory.outcome, ["finished", "skipped"]),
      ),
    )
    .groupBy(listeningHistory.videoId);
  for (const row of plays)
    signals.set(row.videoId, {
      plays: row.plays,
      finished: row.finished,
      earlySkips: row.earlySkips,
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
      ...(signals.get(row.videoId) ?? { plays: 0, finished: 0, earlySkips: 0 }),
      feedback: { value: row.value, at: row.at },
    });
  return signals;
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
