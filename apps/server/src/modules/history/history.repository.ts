import { and, desc, eq, lt, sql } from "drizzle-orm";
import { listeningHistory, type Executor } from "../../db/index.ts";
import type { historyEvent } from "./history.schemas.ts";
import type { z } from "@hono/zod-openapi";

type HistoryEvent = z.infer<typeof historyEvent>;

/** Batches carry the client's event ids: an upload retried after a timeout counts nothing twice. */
export async function recordEvents(
  db: Executor,
  userId: string,
  events: HistoryEvent[],
) {
  const recorded = await db
    .insert(listeningHistory)
    .values(
      events.map((e) => ({
        userId,
        eventId: e.id,
        videoId: e.videoId,
        title: e.title,
        channel: e.channel ?? null,
        outcome: e.outcome,
        listenedMs: e.listenedMs ?? null,
        playedAt: new Date(e.playedAt),
      })),
    )
    .onConflictDoNothing({
      target: [listeningHistory.userId, listeningHistory.eventId],
    })
    .returning({ id: listeningHistory.eventId });
  return recorded.length;
}

/** Newest first; the cursor is the last (playedAt, id) seen. */
export async function listEvents(
  db: Executor,
  userId: string,
  page: { limit: number; before?: string | undefined; beforeId?: string | undefined },
) {
  const cursor = page.before
    ? page.beforeId
      ? sql`(${listeningHistory.playedAt}, ${listeningHistory.eventId}) < (${page.before}::timestamptz, ${page.beforeId}::uuid)`
      : lt(listeningHistory.playedAt, new Date(page.before))
    : undefined;
  return db
    .select({
      id: listeningHistory.eventId,
      videoId: listeningHistory.videoId,
      title: listeningHistory.title,
      channel: listeningHistory.channel,
      outcome: listeningHistory.outcome,
      playedAt: listeningHistory.playedAt,
    })
    .from(listeningHistory)
    .where(and(eq(listeningHistory.userId, userId), cursor))
    .orderBy(desc(listeningHistory.playedAt), desc(listeningHistory.eventId))
    .limit(page.limit);
}

export async function clearHistory(db: Executor, userId: string) {
  const deleted = await db
    .delete(listeningHistory)
    .where(eq(listeningHistory.userId, userId))
    .returning({ id: listeningHistory.eventId });
  return deleted.length;
}
