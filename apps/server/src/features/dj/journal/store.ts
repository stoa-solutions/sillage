import { randomUUID, createHash } from "node:crypto";
import { transaction, type Database } from "../../../db/index.ts";
import { djSystemPrompt } from "../prompt.ts";
import { planTurn } from "../plan.ts";
import type { DjInput } from "../contracts.ts";
import { DjUnavailable } from "../errors.ts";
import { journalPayload } from "./payload.ts";
import type { JournalClientEvent, TraceObserver } from "./contracts.ts";
import {
  EMPTY_MEMORY,
  MEMORY_EXCHANGES,
  summarizeMemory,
  type ConversationMemory,
  type JournalTurn,
} from "../memory.ts";

/**
 * `superseded`: the listener forced a newer message. `busy`: a refill gave way
 * to a typed request. `interrupted`: the server stopped before the turn ended.
 */
export type TurnStatus =
  | "completed"
  | "error"
  | "canceled"
  | "busy"
  | "superseded";
const promptHash = createHash("sha256").update(djSystemPrompt).digest("hex");
const unavailable = (id: string) =>
  console.warn("DJ journal unavailable", { traceId: id });

/** Owns persistence and failure isolation; the agent sees only an in-memory observer. */
export async function beginJournal(
  db: Database,
  owner: string,
  installation: string,
  input: DjInput,
) {
  const id = randomUUID(),
    conversationId = input.conversationId ?? randomUUID();
  const plan = planTurn(input);
  let saved = false,
    failed = false,
    events = 0;
  let pending = Promise.resolve();
  try {
    await transaction(db, async (client) => {
      await client.query(
        "INSERT INTO dj_conversations(user_id,id) VALUES($1,$2) ON CONFLICT(user_id,id) DO UPDATE SET updated_at=now()",
        [owner, conversationId],
      );
      await client.query(
        `INSERT INTO dj_turns(id,user_id,conversation_id,installation_id,request_id,scope,requested_scope,trigger,input,plan,prompt_hash,release_sha)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          owner,
          conversationId,
          installation,
          input.requestId ?? null,
          plan.scope,
          input.scope ?? null,
          plan.trigger,
          JSON.stringify(journalPayload(input)),
          JSON.stringify({
            intent: plan.intent,
            openChoice: plan.openChoice,
            relative: plan.relative,
            targetCount: plan.targetCount,
            selectionLimit: plan.selectionLimit,
            avoidRepeats: plan.avoidRepeats,
            broaden: plan.broaden,
          }),
          promptHash,
          process.env["RELEASE_SHA"] ?? "local",
        ],
      );
    });
    saved = true;
  } catch {
    failed = true;
    unavailable(id);
  }
  const observe: TraceObserver = (event) => {
    if (!saved) return;
    if (events++ >= 64) {
      failed = true;
      return;
    }
    const payload = journalPayload(event);
    // Serial writes start immediately, survive a client cancellation, and never block tools.
    pending = pending
      .then(async () => {
        await db.query(
          "INSERT INTO dj_journal_events(user_id,id,conversation_id,turn_id,scope,origin,kind,payload) VALUES($1,$2,$3,$4,$5,'server',$6,$7)",
          [
            owner,
            randomUUID(),
            conversationId,
            id,
            plan.scope,
            event.kind,
            JSON.stringify(payload),
          ],
        );
      })
      .catch(() => {
        if (!failed) unavailable(id);
        failed = true;
      });
  };
  return {
    id,
    conversationId,
    observe,
    async finish(status: TurnStatus, result: unknown, model?: string) {
      await pending;
      if (saved)
        try {
          await db.query(
            "UPDATE dj_turns SET status=$3,response=$4,model=$5,completed_at=now(),journal_complete=$6 WHERE user_id=$1 AND id=$2",
            [
              owner,
              id,
              status,
              JSON.stringify(journalPayload(result)),
              model ?? null,
              !failed,
            ],
          );
        } catch {
          if (!failed) unavailable(id);
          failed = true;
        }
      return saved && !failed;
    },
  };
}

export function publicJournalError(error: unknown) {
  return {
    error:
      error instanceof DjUnavailable ? error.message : "Erreur interne du DJ.",
    status: error instanceof DjUnavailable ? error.status : 500,
  };
}

export async function uploadJournalEvents(
  db: Database,
  owner: string,
  conversationId: string,
  events: JournalClientEvent[],
) {
  return transaction(db, async (client) => {
    await client.query(
      "INSERT INTO dj_conversations(user_id,id) VALUES($1,$2) ON CONFLICT(user_id,id) DO UPDATE SET updated_at=now()",
      [owner, conversationId],
    );
    const result = await client.query(
      `INSERT INTO dj_journal_events(user_id,id,conversation_id,scope,origin,kind,payload,client_sequence,occurred_at)
      SELECT $1,e.id::uuid,$2,e.scope,'client',e.kind,e.payload,e.sequence,e.occurred_at::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS e(id text,scope text,kind text,payload jsonb,sequence int,occurred_at text)
      ON CONFLICT(user_id,id) DO NOTHING`,
      [
        owner,
        conversationId,
        JSON.stringify(
          events.map((event) => ({
            id: event.id,
            scope: event.scope,
            kind: event.kind,
            payload: journalPayload(event),
            sequence: event.sequence,
            occurred_at: event.occurredAt,
          })),
        ),
      ],
    );
    return result.rowCount ?? 0;
  });
}

/**
 * Rebuild the DJ's memory of a conversation from its journal. A journal outage
 * degrades to an empty memory: the turn still runs with the client's history.
 */
export async function loadConversationMemory(
  db: Database,
  owner: string,
  conversationId: string,
  currentTurnId: string,
): Promise<ConversationMemory> {
  try {
    const { rows } = await db.query(
      `SELECT id,trigger,status,input,response FROM dj_turns
      WHERE user_id=$1 AND conversation_id=$2 AND id<>$3 AND status<>'running'
      ORDER BY started_at DESC,id DESC LIMIT $4`,
      [owner, conversationId, currentTurnId, MEMORY_EXCHANGES * 3],
    );
    const turns: JournalTurn[] = rows;
    const latest = turns[0];
    if (latest?.status === "superseded" || latest?.status === "canceled") {
      const events = await db.query(
        `SELECT payload->'input' AS input,payload->'output' AS output FROM dj_journal_events
        WHERE user_id=$1 AND turn_id=$2 AND kind='tool' ORDER BY sequence LIMIT 16`,
        [owner, rows[0].id],
      );
      turns[0] = { ...latest, tools: events.rows };
    }
    return summarizeMemory(turns);
  } catch {
    return EMPTY_MEMORY;
  }
}

/** A restarted server cannot finish the turns it was running; close them honestly. */
export async function closeInterruptedTurns(db: Database) {
  const { rowCount } = await db.query(
    `UPDATE dj_turns SET status='interrupted',completed_at=now(),
    response=jsonb_build_object('error','Le serveur a redémarré pendant ce tour.','status',503)
    WHERE status='running'`,
  );
  return rowCount ?? 0;
}
