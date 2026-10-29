import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, ne, sql } from "drizzle-orm";
import {
  djConversations,
  djJournalEvents,
  djTurns,
  type Executor,
} from "../../../../db/index.ts";

type Scope = (typeof djTurns.$inferInsert)["scope"];
type Status = (typeof djTurns.$inferInsert)["status"] & string;

async function touchConversation(db: Executor, owner: string, id: string) {
  await db
    .insert(djConversations)
    .values({ userId: owner, id })
    .onConflictDoUpdate({
      target: [djConversations.userId, djConversations.id],
      set: { updatedAt: sql`now()` },
    });
}

/** Opens a running turn in its conversation, which is created on first use. */
export async function openTurn(
  db: Executor,
  turn: typeof djTurns.$inferInsert,
) {
  await db.transaction(async (tx) => {
    await touchConversation(tx, turn.userId, turn.conversationId);
    await tx.insert(djTurns).values(turn);
  });
}

export async function appendServerEvent(
  db: Executor,
  event: {
    owner: string;
    conversationId: string;
    turnId: string;
    scope: Scope;
    kind: string;
    payload: unknown;
  },
) {
  await db.insert(djJournalEvents).values({
    userId: event.owner,
    id: randomUUID(),
    conversationId: event.conversationId,
    turnId: event.turnId,
    scope: event.scope,
    origin: "server",
    kind: event.kind,
    payload: event.payload,
  });
}

export async function finishTurn(
  db: Executor,
  owner: string,
  id: string,
  result: { status: Status; response: unknown; model: string | null; complete: boolean },
) {
  await db
    .update(djTurns)
    .set({
      status: result.status,
      response: result.response,
      model: result.model,
      completedAt: sql`now()`,
      journalComplete: result.complete,
    })
    .where(and(eq(djTurns.userId, owner), eq(djTurns.id, id)));
}

/** Client events carry their own ids: a batch sent again after a timeout adds nothing. */
export async function recordClientEvents(
  db: Executor,
  owner: string,
  conversationId: string,
  events: {
    id: string;
    scope: Scope;
    kind: string;
    payload: unknown;
    sequence: number;
    occurredAt: string;
  }[],
) {
  return db.transaction(async (tx) => {
    await touchConversation(tx, owner, conversationId);
    const recorded = await tx
      .insert(djJournalEvents)
      .values(
        events.map((event) => ({
          userId: owner,
          id: event.id,
          conversationId,
          scope: event.scope,
          origin: "client" as const,
          kind: event.kind,
          payload: event.payload,
          clientSequence: event.sequence,
          occurredAt: new Date(event.occurredAt),
        })),
      )
      .onConflictDoNothing({
        target: [djJournalEvents.userId, djJournalEvents.id],
      })
      .returning({ id: djJournalEvents.id });
    return recorded.length;
  });
}

/** The conversation's finished turns, newest first, except the one being answered. */
export async function finishedTurns(
  db: Executor,
  owner: string,
  conversationId: string,
  exceptTurnId: string,
  limit: number,
) {
  return db
    .select({
      id: djTurns.id,
      trigger: djTurns.trigger,
      status: djTurns.status,
      input: djTurns.input,
      response: djTurns.response,
    })
    .from(djTurns)
    .where(
      and(
        eq(djTurns.userId, owner),
        eq(djTurns.conversationId, conversationId),
        ne(djTurns.id, exceptTurnId),
        ne(djTurns.status, "running"),
      ),
    )
    .orderBy(desc(djTurns.startedAt), desc(djTurns.id))
    .limit(limit);
}

/** Inputs and outputs of a turn's tool calls, in order. */
export async function toolEvents(db: Executor, owner: string, turnId: string) {
  return db
    .select({
      input: sql<unknown>`${djJournalEvents.payload}->'input'`,
      output: sql<unknown>`${djJournalEvents.payload}->'output'`,
    })
    .from(djJournalEvents)
    .where(
      and(
        eq(djJournalEvents.userId, owner),
        eq(djJournalEvents.turnId, turnId),
        eq(djJournalEvents.kind, "tool"),
      ),
    )
    .orderBy(asc(djJournalEvents.sequence))
    .limit(16);
}

/** Turns left running by a stopped server, closed with an explanation. */
export async function interruptRunningTurns(db: Executor) {
  const closed = await db
    .update(djTurns)
    .set({
      status: "interrupted",
      completedAt: sql`now()`,
      response: { error: "Le serveur a redémarré pendant ce tour.", status: 503 },
    })
    .where(eq(djTurns.status, "running"))
    .returning({ id: djTurns.id });
  return closed.length;
}

export async function conversationExists(
  db: Executor,
  owner: string,
  id: string,
) {
  const rows = await db
    .select({ id: djConversations.id })
    .from(djConversations)
    .where(and(eq(djConversations.userId, owner), eq(djConversations.id, id)));
  return rows.length > 0;
}

/** Newest conversations first; `before` is the id of the last one already seen. */
export async function listConversations(
  db: Executor,
  owner: string,
  page: { before?: string | undefined; limit: number },
) {
  const turns = db
    .select({ count: count() })
    .from(djTurns)
    .where(
      and(
        eq(djTurns.userId, djConversations.userId),
        eq(djTurns.conversationId, djConversations.id),
      ),
    );
  const messages = db
    .select({ count: count() })
    .from(djJournalEvents)
    .where(
      and(
        eq(djJournalEvents.userId, djConversations.userId),
        eq(djJournalEvents.conversationId, djConversations.id),
        eq(djJournalEvents.kind, "message"),
      ),
    );
  return db
    .select({
      id: djConversations.id,
      createdAt: djConversations.createdAt,
      updatedAt: djConversations.updatedAt,
      turns: sql<number>`(${turns})::int`,
      messages: sql<number>`(${messages})::int`,
    })
    .from(djConversations)
    .where(
      and(
        eq(djConversations.userId, owner),
        page.before
          ? sql`(${djConversations.createdAt}, ${djConversations.id}) < (SELECT created_at, id FROM dj_conversations WHERE user_id = ${owner} AND id = ${page.before})`
          : undefined,
      ),
    )
    .orderBy(desc(djConversations.createdAt), desc(djConversations.id))
    .limit(page.limit);
}

/** Summaries of a conversation's turns, newest first; `stale` flags one running for 5 minutes. */
export async function listTurns(
  db: Executor,
  owner: string,
  conversationId: string,
  page: { before?: string | undefined; limit: number },
) {
  return db
    .select({
      id: djTurns.id,
      requestId: djTurns.requestId,
      scope: djTurns.scope,
      requestedScope: djTurns.requestedScope,
      trigger: djTurns.trigger,
      status: djTurns.status,
      model: djTurns.model,
      startedAt: djTurns.startedAt,
      completedAt: djTurns.completedAt,
      journalComplete: djTurns.journalComplete,
      action: sql<string | null>`${djTurns.response}->>'action'`,
      reply: sql<string | null>`${djTurns.response}->>'reply'`,
      stale: sql<boolean>`(${djTurns.status} = 'running' AND ${djTurns.startedAt} < now() - interval '5 minutes')`,
    })
    .from(djTurns)
    .where(
      and(
        eq(djTurns.userId, owner),
        eq(djTurns.conversationId, conversationId),
        page.before
          ? sql`(${djTurns.startedAt}, ${djTurns.id}) < (SELECT started_at, id FROM dj_turns WHERE user_id = ${owner} AND conversation_id = ${conversationId} AND id = ${page.before})`
          : undefined,
      ),
    )
    .orderBy(desc(djTurns.startedAt), desc(djTurns.id))
    .limit(page.limit);
}

/** Events in reception order after a sequence cursor (bigint kept as a string). */
export async function listEvents(
  db: Executor,
  owner: string,
  conversationId: string,
  page: { after: string; limit: number },
) {
  return db
    .select({
      sequence: sql<string>`${djJournalEvents.sequence}::text`,
      id: djJournalEvents.id,
      turnId: djJournalEvents.turnId,
      scope: djJournalEvents.scope,
      origin: djJournalEvents.origin,
      kind: djJournalEvents.kind,
      payload: djJournalEvents.payload,
      clientSequence: djJournalEvents.clientSequence,
      occurredAt: djJournalEvents.occurredAt,
      receivedAt: djJournalEvents.receivedAt,
    })
    .from(djJournalEvents)
    .where(
      and(
        eq(djJournalEvents.userId, owner),
        eq(djJournalEvents.conversationId, conversationId),
        gt(djJournalEvents.sequence, sql`${page.after}::bigint`),
      ),
    )
    .orderBy(asc(djJournalEvents.sequence))
    .limit(page.limit);
}

/** A turn with every event, or null when it is not the account's. */
export async function turnWithEvents(db: Executor, owner: string, turnId: string) {
  const [turn] = await db
    .select()
    .from(djTurns)
    .where(and(eq(djTurns.userId, owner), eq(djTurns.id, turnId)));
  if (!turn) return null;
  const events = await db
    .select({
      sequence: sql<string>`${djJournalEvents.sequence}::text`,
      kind: djJournalEvents.kind,
      payload: djJournalEvents.payload,
      receivedAt: djJournalEvents.receivedAt,
    })
    .from(djJournalEvents)
    .where(and(eq(djJournalEvents.userId, owner), eq(djJournalEvents.turnId, turnId)))
    .orderBy(asc(djJournalEvents.sequence));
  return { turn, events };
}

/** Deletes a conversation of the account with its turns and events (cascade). */
export async function deleteConversation(db: Executor, owner: string, id: string) {
  const deleted = await db
    .delete(djConversations)
    .where(and(eq(djConversations.userId, owner), eq(djConversations.id, id)))
    .returning({ id: djConversations.id });
  return deleted.length > 0;
}
