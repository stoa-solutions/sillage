import { LEGACY_USER } from "../accounts/index.ts";
import type { Database } from "../../db/index.ts";
import { DjUnavailable } from "./errors.ts";

export function djDailyBudget(userId: string, now = Date.now()): number | null {
  let override: unknown;
  try {
    override = JSON.parse(process.env.DJ_ACCOUNT_DAILY_LIMITS ?? "{}")[userId];
  } catch {
    /* Invalid overrides retain the shared default. */
  }
  if (override && typeof override === "object") {
    const timed = override as {
      limit?: unknown;
      unlimitedUntil?: unknown;
      unlimited?: unknown;
    };
    if (timed.unlimited === true) return null;
    if (
      typeof timed.unlimitedUntil === "string" &&
      Date.parse(timed.unlimitedUntil) > now
    )
      return null;
    override = timed.limit;
  }
  const configured =
    typeof override === "number" && Number.isFinite(override) && override > 0
      ? override
      : Number(process.env.DJ_DAILY_REQUEST_LIMIT) || 100;
  return Math.floor(Math.max(1, Math.min(1000, configured)));
}
export async function reserveDj(db: Database, userId = LEGACY_USER) {
  const budget = djDailyBudget(userId);
  const used = await db.query(
    `INSERT INTO account_dj_usage(user_id,day,requests) VALUES($2,CURRENT_DATE,1)
    ON CONFLICT(user_id,day) DO UPDATE SET requests=account_dj_usage.requests+1 WHERE $1::int IS NULL OR account_dj_usage.requests<$1 RETURNING requests`,
    [budget, userId],
  );
  if (!used.rowCount)
    throw new DjUnavailable(
      `Le plafond quotidien de Recall (${budget} demandes et réponses vocales) est atteint. Ce plafond est distinct du quota Google ; la lecture de ta file reste disponible.`,
      429,
    );
}
