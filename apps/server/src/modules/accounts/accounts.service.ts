import { hash } from "../../shared/content.ts";
import { LEGACY_USER_ID, type Database } from "../../db/index.ts";
import { holdsLiveToken, revokeSession } from "../auth/index.ts";
import { accountProfile, claimLegacyLibrary } from "./accounts.repository.ts";

/** The signed-in account: profile, sign-out of this installation, historical library claim. */
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
    /** The proof is a live token of the historical account; one claim ever. */
    claimLibrary(userId: string, legacyToken: string) {
      return claimLegacyLibrary(db.orm, userId, (tx) =>
        holdsLiveToken(tx, LEGACY_USER_ID, hash(legacyToken)),
      );
    },
  };
}
