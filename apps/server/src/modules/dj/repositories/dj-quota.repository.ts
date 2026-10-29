import { sql } from "drizzle-orm";
import { accountDjUsage, type Executor } from "../../../db/index.ts";

/**
 * Counts one DJ request for today, unless the budget is reached (null: unlimited). Atomic: two
 * concurrent requests can never both take the last unit.
 */
export async function takeDailyUnit(
  db: Executor,
  userId: string,
  budget: number | null,
) {
  const counted = await db
    .insert(accountDjUsage)
    .values({ userId, day: sql`CURRENT_DATE`, requests: 1 })
    .onConflictDoUpdate({
      target: [accountDjUsage.userId, accountDjUsage.day],
      set: { requests: sql`${accountDjUsage.requests} + 1` },
      ...(budget === null
        ? {}
        : { setWhere: sql`${accountDjUsage.requests} < ${budget}` }),
    })
    .returning({ requests: accountDjUsage.requests });
  return counted.length > 0;
}
