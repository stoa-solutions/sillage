import { Hono } from "hono";
import { hash } from "../../content.ts";
import { LEGACY_USER_ID, type Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import { holdsLiveToken, revokeSession } from "../auth/index.ts";
import { claimLibraryInput } from "./contracts.ts";
import { accountProfile, claimLegacyLibrary } from "./store.ts";

/** The signed-in account, under /v1 behind the session guard. */
export function accountRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.get("/me", async (c) =>
    c.json(await accountProfile(db.orm, c.get("userId"))),
  );
  app.post("/logout", async (c) => {
    await revokeSession(db.orm, c.get("installationId"));
    return c.json({ saved: true });
  });
  app.post("/account/claim-library", async (c) => {
    const { legacyToken } = claimLibraryInput.parse(await c.req.json());
    const claimed = await claimLegacyLibrary(db.orm, c.get("userId"), (tx) =>
      holdsLiveToken(tx, LEGACY_USER_ID, hash(legacyToken)),
    );
    return claimed
      ? c.json({ saved: true })
      : c.json(
          { error: "Bibliothèque déjà transférée ou preuve invalide." },
          403,
        );
  });
  return app;
}
