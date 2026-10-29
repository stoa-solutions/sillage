import type { z } from "@hono/zod-openapi";
import type { Database } from "../../../db/index.ts";
import { clearHistory, listEvents, recordEvents } from "../repositories/history.repository.ts";
import type { historyEvent, historyPage } from "../types/history.schemas.ts";

/**
 * What each account played and how it ended. Title and channel are copied because a played
 * YouTube video need not be in the library. Read back by the Discover home.
 */
export function historyService(db: Database) {
  return {
    record: (userId: string, events: z.infer<typeof historyEvent>[]) =>
      recordEvents(db.orm, userId, events),
    async list(userId: string, page: z.output<typeof historyPage>) {
      const rows = await listEvents(db.orm, userId, page);
      return rows.map((row) => ({ ...row, playedAt: row.playedAt.toISOString() }));
    },
    clear: (userId: string) => clearHistory(db.orm, userId),
  };
}
