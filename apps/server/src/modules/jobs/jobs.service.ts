import { LEGACY_USER_ID, type Database } from "../../db/index.ts";
import { retryFailed } from "./jobs.repository.ts";

/** Queue maintenance, reserved to the historical maintenance account. */
export function jobsService(db: Database) {
  return {
    /** null when the account may not run maintenance. */
    async retryFailed(userId: string) {
      if (userId !== LEGACY_USER_ID) return null;
      return retryFailed(db.orm);
    },
  };
}
