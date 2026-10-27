import { Hono } from "hono";
import { hash } from "../../content.ts";
import type { Database } from "../../db.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import { revokeSession } from "../auth/index.ts";
import { claimLibraryInput } from "./contracts.ts";
import { accountProfile, claimLegacyLibrary } from "./store.ts";

/** The signed-in account, under /v1 behind the session guard. */
export function accountRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.get("/me", async (c) =>
    c.json(await accountProfile(db.prisma, c.get("userId"))),
  );
  app.post("/logout", async (c) => {
    await revokeSession(db.prisma, c.get("installationId"));
    return c.json({ saved: true });
  });
  app.post("/account/claim-library", async (c) => {
    const { legacyToken } = claimLibraryInput.parse(await c.req.json());
    const claimed = await claimLegacyLibrary(
      db.prisma,
      c.get("userId"),
      hash(legacyToken),
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
