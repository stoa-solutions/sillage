import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "./db.ts";
import type { ApiEnvironment } from "./api-environment.ts";

// Listening history: what each account played and how it ended. The Mac sends events in
// batches with its own IDs, so a retried upload never counts a play twice. Title and channel
// are copied because a played YouTube video need not be in the library. Kept for later taste
// signals used by the account-scoped Discover home.
const outcomes = ["finished", "skipped", "unavailable", "replaced"] as const;
export const historyEvent = z.object({
  id: z.string().uuid(),
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(300),
  channel: z.string().max(200).nullable().optional(),
  outcome: z.enum(outcomes),
  playedAt: z.string().datetime({ offset: true }),
});
export const historyUpload = z.object({ events: z.array(historyEvent).min(1).max(100) });
// Keyset cursor: plays seen together share a date, so the event ID breaks ties.
export const historyPage = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
  })
  .refine((p) => !p.beforeId || p.before);

export function historyRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.post("/", async (c) => {
    const { events } = historyUpload.parse(await c.req.json().catch(() => null));
    const result = await db.query(
      `INSERT INTO listening_history(user_id,event_id,video_id,title,channel,outcome,played_at)
       SELECT $1,e.id::uuid,e.video_id,e.title,e.channel,e.outcome,e.played_at::timestamptz
       FROM jsonb_to_recordset($2::jsonb) AS e(id text,video_id text,title text,channel text,outcome text,played_at text)
       ON CONFLICT(user_id,event_id) DO NOTHING`,
      [
        c.get("userId"),
        JSON.stringify(
          events.map((e) => ({
            id: e.id,
            video_id: e.videoId,
            title: e.title,
            channel: e.channel ?? null,
            outcome: e.outcome,
            played_at: e.playedAt,
          })),
        ),
      ],
    );
    return c.json({ recorded: result.rowCount ?? 0 });
  });
  app.get("/", async (c) => {
    const { limit, before, beforeId } = historyPage.parse(c.req.query());
    const rows = (
      await db.query(
        `SELECT event_id AS id,video_id AS "videoId",title,channel,outcome,played_at AS "playedAt"
         FROM listening_history WHERE user_id=$1
           AND ($2::timestamptz IS NULL OR ($3::uuid IS NULL AND played_at<$2) OR (played_at,event_id)<($2,$3::uuid))
         ORDER BY played_at DESC,event_id DESC LIMIT $4`,
        [c.get("userId"), before ?? null, beforeId ?? null, limit],
      )
    ).rows;
    return c.json({ events: rows });
  });
  app.delete("/", async (c) => {
    const result = await db.query(
      "DELETE FROM listening_history WHERE user_id=$1",
      [c.get("userId")],
    );
    return c.json({ deleted: result.rowCount ?? 0 });
  });
  return app;
}
