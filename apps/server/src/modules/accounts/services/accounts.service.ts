import type { Database } from "../../../db/index.ts";
import { revokeSession } from "../../auth/index.ts";
import { accountProfile } from "../repositories/accounts.repository.ts";

/** The signed-in account: profile and sign-out of this installation. */
export function accountsService(db: Database) {
  return {
    async profile(userId: string) {
      const profile = await accountProfile(db.orm, userId);
      // The session guard only lets through tokens whose account exists.
      if (!profile) throw new Error("Session without account");
      return profile;
    },
    async logout(installationId: string) {
      await revokeSession(db.orm, installationId);
    },
  };
}
