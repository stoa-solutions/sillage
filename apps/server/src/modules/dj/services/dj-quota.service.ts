import type { Database } from "../../../db/index.ts";
import { DjUnavailable } from "../errors.ts";
import { takeDailyUnit } from "../repositories/dj-quota.repository.ts";

export function djDailyBudget(userId: string, now = Date.now()): number | null {
  let override: unknown;
  try {
    override = JSON.parse(process.env["DJ_ACCOUNT_DAILY_LIMITS"] ?? "{}")[userId];
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
      : Number(process.env["DJ_DAILY_REQUEST_LIMIT"]) || 100;
  return Math.floor(Math.max(1, Math.min(1000, configured)));
}
/** Takes one unit of the account's daily DJ budget, or refuses with a 429. */
export async function reserveDj(db: Database, userId: string) {
  const budget = djDailyBudget(userId);
  if (!(await takeDailyUnit(db.orm, userId, budget)))
    throw new DjUnavailable(
      `Le plafond quotidien de Sillage (${budget} demandes et réponses vocales) est atteint. Ce plafond est distinct du quota Google ; la lecture de ta file reste disponible.`,
      429,
    );
}
