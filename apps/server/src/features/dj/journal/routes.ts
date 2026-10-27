import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../../db/index.ts";
import type { ApiEnvironment } from "../../../shared/api-environment.ts";
import { journalPage, journalEventPage, journalUpload } from "./contracts.ts";
import { uploadJournalEvents } from "./store.ts";

const id = z.string().uuid();
export function journalRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.get("/conversations", async (c) => {
    const owner = c.get("userId"),
      page = journalPage.parse(c.req.query());
    const { rows } = await db.query(
      `SELECT c.id,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
      (SELECT count(*)::int FROM dj_turns t WHERE t.user_id=c.user_id AND t.conversation_id=c.id) AS turns,
      (SELECT count(*)::int FROM dj_journal_events e WHERE e.user_id=c.user_id AND e.conversation_id=c.id AND e.kind='message') AS messages
      FROM dj_conversations c WHERE c.user_id=$1 AND ($2::uuid IS NULL OR (c.created_at,c.id)<(SELECT created_at,id FROM dj_conversations WHERE user_id=$1 AND id=$2))
      ORDER BY c.created_at DESC,c.id DESC LIMIT $3`,
      [owner, page.before ?? null, page.limit + 1],
    );
    const conversations = rows.slice(0, page.limit);
    return c.json({
      conversations,
      nextCursor: rows.length > page.limit ? conversations.at(-1)!.id : null,
    });
  });
  async function owned(owner: string, conversationId: string) {
    return Boolean(
      (
        await db.query(
          "SELECT 1 FROM dj_conversations WHERE user_id=$1 AND id=$2",
          [owner, conversationId],
        )
      ).rowCount,
    );
  }
  app.get("/conversations/:conversationId/turns", async (c) => {
    const owner = c.get("userId"),
      conversationId = id.parse(c.req.param("conversationId")),
      page = journalPage.parse(c.req.query());
    if (!(await owned(owner, conversationId)))
      return c.json({ error: "Conversation inconnue." }, 404);
    const { rows } = await db.query(
      `SELECT id,request_id AS "requestId",scope,requested_scope AS "requestedScope",trigger,status,model,
      started_at AS "startedAt",completed_at AS "completedAt",journal_complete AS "journalComplete",response->>'action' AS action,response->>'reply' AS reply,
      (status='running' AND started_at<now()-interval '5 minutes') AS stale
      FROM dj_turns WHERE user_id=$1 AND conversation_id=$2 AND ($3::uuid IS NULL OR (started_at,id)<(SELECT started_at,id FROM dj_turns WHERE user_id=$1 AND conversation_id=$2 AND id=$3))
      ORDER BY started_at DESC,id DESC LIMIT $4`,
      [owner, conversationId, page.before ?? null, page.limit + 1],
    );
    const turns = rows.slice(0, page.limit);
    return c.json({
      turns,
      nextCursor: rows.length > page.limit ? turns.at(-1)!.id : null,
    });
  });
  app.get("/conversations/:conversationId/events", async (c) => {
    const owner = c.get("userId"),
      conversationId = id.parse(c.req.param("conversationId")),
      page = journalEventPage.parse(c.req.query());
    if (!(await owned(owner, conversationId)))
      return c.json({ error: "Conversation inconnue." }, 404);
    const { rows } = await db.query(
      `SELECT sequence::text,id,turn_id AS "turnId",scope,origin,kind,payload,
      client_sequence AS "clientSequence",occurred_at AS "occurredAt",received_at AS "receivedAt"
      FROM dj_journal_events WHERE user_id=$1 AND conversation_id=$2 AND sequence>$3::bigint ORDER BY dj_journal_events.sequence LIMIT $4`,
      [owner, conversationId, page.after, page.limit + 1],
    );
    const events = rows.slice(0, page.limit);
    return c.json({
      events,
      nextCursor: rows.length > page.limit ? events.at(-1)!.sequence : null,
    });
  });
  app.post("/conversations/:conversationId/events", async (c) => {
    const conversationId = id.parse(c.req.param("conversationId")),
      { events } = journalUpload.parse(await c.req.json());
    return c.json({
      recorded: await uploadJournalEvents(
        db,
        c.get("userId"),
        conversationId,
        events,
      ),
    });
  });
  app.get("/turns/:turnId", async (c) => {
    const owner = c.get("userId"),
      turnId = id.parse(c.req.param("turnId"));
    const { rows } = await db.query(
      "SELECT * FROM dj_turns WHERE user_id=$1 AND id=$2",
      [owner, turnId],
    );
    if (!rows.length) return c.json({ error: "Tour inconnu." }, 404);
    const events = await db.query(
      'SELECT sequence::text,kind,payload,received_at AS "receivedAt" FROM dj_journal_events WHERE user_id=$1 AND turn_id=$2 ORDER BY dj_journal_events.sequence',
      [owner, turnId],
    );
    return c.json({ turn: rows[0], events: events.rows });
  });
  app.delete("/conversations/:conversationId", async (c) => {
    const conversationId = id.parse(c.req.param("conversationId"));
    const result = await db.query(
      "DELETE FROM dj_conversations WHERE user_id=$1 AND id=$2",
      [c.get("userId"), conversationId],
    );
    return result.rowCount
      ? c.json({ deleted: true })
      : c.json({ error: "Conversation inconnue." }, 404);
  });
  return app;
}
