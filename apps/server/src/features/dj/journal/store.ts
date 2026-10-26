import { randomUUID, createHash } from "node:crypto";
import { transaction, type Database } from "../../../db.ts";
import { djSystemPrompt } from "../../../dj-prompt.ts";
import { planTurn } from "../context.ts";
import type { DjInput } from "../contracts.ts";
import { DjUnavailable } from "../errors.ts";
import { journalPayload } from "./payload.ts";
import type { JournalClientEvent, TraceObserver } from "./contracts.ts";

type TurnStatus = "completed" | "error" | "canceled" | "busy";
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
          input.trigger ?? "user",
          JSON.stringify(journalPayload(input)),
          JSON.stringify({
            intent: plan.intent,
            relative: plan.relative,
            targetCount: plan.targetCount,
            avoidRepeats: plan.avoidRepeats,
          }),
          promptHash,
          process.env.RELEASE_SHA ?? "local",
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
