/**
 * What the DJ remembers of its conversation, rebuilt from the server journal
 * rather than from the client's text history. Only facts the server verified
 * (requests, replies, tracks it returned, searches it ran) are remembered;
 * the model's private reasoning never is.
 */

export interface MemoryExchange {
  request: string;
  trigger: "user" | "continuation";
  reply: string;
  /** Titles the DJ played, queued or proposed in this exchange. */
  tracks: string[];
}

/** A turn the listener interrupted, by forcing a newer message or cancelling it. */
export interface InterruptedTurn {
  request: string;
  searches: string[];
  candidates: string[];
}

export interface ConversationMemory {
  exchanges: MemoryExchange[];
  /** Older exchanges, compressed to one line. */
  earlier?: { exchanges: number; tracks: number };
  interrupted?: InterruptedTurn;
}

export const EMPTY_MEMORY: ConversationMemory = { exchanges: [] };
const INTERRUPTED = new Set(["superseded", "canceled"]);
export const MEMORY_EXCHANGES = 20;

/** A journal row as stored by the turn journal; every field is untrusted JSON. */
export interface JournalTurn {
  trigger: "user" | "continuation";
  status: string;
  input: unknown;
  response: unknown;
  /** Server tool events of this turn, only loaded for an interrupted turn. */
  tools?: { input: unknown; output: unknown }[];
}

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function requestOf(turn: JournalTurn) {
  return turn.trigger === "continuation"
    ? "(suite automatique)"
    : text(record(turn.input).message, 300);
}

function titlesOf(response: unknown) {
  const value = record(response);
  return [
    ...list(value.tracks).map((track) => text(record(track).title, 120)),
    ...list(value.discoveries).map((card) =>
      text(record(record(card).video).title, 120),
    ),
  ].filter(Boolean);
}

function interruptedTurn(turn: JournalTurn): InterruptedTurn {
  const searches = new Set<string>();
  const candidates = new Set<string>();
  for (const call of turn.tools ?? []) {
    const query = text(record(call.input).query, 120);
    if (query) searches.add(query);
    const output = record(call.output);
    for (const item of [...list(output.results), ...list(output.tracks)]) {
      const title = text(record(record(item).video ?? item).title, 120);
      if (title) candidates.add(title);
    }
  }
  return {
    request: requestOf(turn),
    searches: [...searches].slice(0, 8),
    candidates: [...candidates].slice(0, 12),
  };
}

/**
 * Summarize the conversation's turns, newest first, into bounded memory.
 * Refused or failed turns are not exchanges: they taught the listener nothing.
 */
export function summarizeMemory(
  newestFirst: JournalTurn[],
  limit = MEMORY_EXCHANGES,
): ConversationMemory {
  const latest = newestFirst[0];
  // The client drops its request before forcing the next one, so the server
  // may record the interruption as either a supersession or a cancellation.
  const interrupted =
    latest && INTERRUPTED.has(latest.status) ? interruptedTurn(latest) : undefined;
  const completed = newestFirst
    .filter((turn) => turn.status === "completed")
    .map(
      (turn): MemoryExchange => ({
        request: requestOf(turn),
        trigger: turn.trigger,
        reply: text(record(turn.response).reply, 400),
        tracks: titlesOf(turn.response).slice(0, 8),
      }),
    )
    .filter((exchange) => exchange.request || exchange.reply);
  const older = completed.slice(limit);
  return {
    exchanges: completed.slice(0, limit).reverse(),
    ...(older.length
      ? {
          earlier: {
            exchanges: older.length,
            tracks: older.reduce((sum, item) => sum + item.tracks.length, 0),
          },
        }
      : {}),
    ...(interrupted ? { interrupted } : {}),
  };
}

/** Titles already offered in this conversation; a refill must not repeat them. */
export function rememberedTitles(memory: ConversationMemory) {
  return [...new Set(memory.exchanges.flatMap((exchange) => exchange.tracks))];
}
