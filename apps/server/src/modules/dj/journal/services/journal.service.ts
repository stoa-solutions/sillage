import { randomUUID, createHash } from "node:crypto";
import type { Database } from "../../../../db/index.ts";
import {
  appendServerEvent,
  finishTurn,
  finishedTurns,
  interruptRunningTurns,
  openTurn,
  recordClientEvents,
  toolEvents,
} from "../repositories/journal.repository.ts";
import type { ResolvedAgent } from "../../../dj-agents/index.ts";
import { djSystemPrompt } from "../../turn/prompt.ts";
import { planTurn } from "../../turn/plan.ts";
import type { DjInput } from "../../types/dj.contracts.ts";
import { DjUnavailable } from "../../errors.ts";
import { journalPayload } from "../journal.payload.ts";
import type { JournalClientEvent, TraceObserver } from "../types/journal.contracts.ts";
import {
  EMPTY_MEMORY,
  MEMORY_EXCHANGES,
  summarizeMemory,
  type ConversationMemory,
  type JournalTurn,
} from "../../turn/memory.ts";
import { logger } from "../../../../shared/logger.ts";

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
  logger.warn({ traceId: id }, "DJ journal unavailable");

/** Owns persistence and failure isolation; the agent sees only an in-memory observer. */
export async function beginJournal(
  db: Database,
  owner: string,
  installation: string,
  input: DjInput,
  agent?: ResolvedAgent["trace"],
) {
  const id = randomUUID(),
    conversationId = input.conversationId ?? randomUUID();
  const plan = planTurn(input);
  let saved = false,
    failed = false,
    events = 0;
  let pending = Promise.resolve();
  try {
    await openTurn(db.orm, {
      id,
      userId: owner,
      conversationId,
      installationId: installation,
      requestId: input.requestId ?? null,
      scope: plan.scope,
      requestedScope: input.scope ?? null,
      trigger: plan.trigger,
      input: journalPayload(input),
      plan: {
        intent: plan.intent,
        openChoice: plan.openChoice,
        relative: plan.relative,
        targetCount: plan.targetCount,
        selectionLimit: plan.selectionLimit,
        avoidRepeats: plan.avoidRepeats,
        broaden: plan.broaden,
        ...(agent ? { agent } : {}),
      },
      promptHash,
      releaseSha: process.env["RELEASE_SHA"] ?? "local",
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
        await appendServerEvent(db.orm, {
          owner,
          conversationId,
          turnId: id,
          scope: plan.scope,
          kind: event.kind,
          payload,
        });
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
          await finishTurn(db.orm, owner, id, {
            status,
            response: journalPayload(result),
            model: model ?? null,
            complete: !failed,
          });
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

/** Messages and actions reported by the app; the owner and origin are never the client's. */
export async function uploadJournalEvents(
  db: Database,
  owner: string,
  conversationId: string,
  events: JournalClientEvent[],
) {
  return recordClientEvents(
    db.orm,
    owner,
    conversationId,
    events.map((event) => ({
      id: event.id,
      scope: event.scope,
      kind: event.kind,
      payload: journalPayload(event),
      sequence: event.sequence,
      occurredAt: event.occurredAt,
    })),
  );
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
    const turns: (JournalTurn & { id: string })[] = await finishedTurns(
      db.orm,
      owner,
      conversationId,
      currentTurnId,
      MEMORY_EXCHANGES * 3,
    );
    const latest = turns[0];
    // A forced or cancelled turn left no answer: its tool results are what it learned.
    if (latest?.status === "superseded" || latest?.status === "canceled")
      turns[0] = { ...latest, tools: await toolEvents(db.orm, owner, latest.id) };
    return summarizeMemory(turns);
  } catch {
    return EMPTY_MEMORY;
  }
}

/** A restarted server cannot finish the turns it was running; close them honestly. */
export function closeInterruptedTurns(db: Database) {
  return interruptRunningTurns(db.orm);
}
