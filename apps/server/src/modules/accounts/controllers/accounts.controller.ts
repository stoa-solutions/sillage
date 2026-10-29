import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../../db/index.ts";
import type { ApiEnvironment } from "../../../shared/api-environment.ts";
import {
  commonErrors,
  featureRouter,
  jsonResponse,
  operation,
  savedBody,
} from "../../../shared/openapi.ts";
import { accountBody } from "../types/accounts.schemas.ts";
import { accountsService } from "../services/accounts.service.ts";

const TAG = "Compte";
const meRoute = createRoute({
  method: "get",
  path: "/me",
  ...operation({
    operationId: "getAccount",
    tag: TAG,
    summary: "Compte courant",
    description:
      "Compte associé au jeton Bearer. Chaque session détermine son userId côté serveur ; un client ne peut pas choisir le compte d’un autre utilisateur.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(accountBody, "Réponse réussie") },
});
const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  ...operation({
    operationId: "revokeSession",
    tag: TAG,
    summary: "Déconnecter cette session",
    effect: "write",
    description:
      "Révoque le jeton utilisé pour cet appel. Les autres sessions du compte restent actives.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(savedBody, "Réponse réussie") },
});
/** The signed-in account, mounted under /v1 behind the session guard. */
export function accountRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  const accounts = accountsService(db);
  app.openapi(meRoute, async (c) =>
    c.json(await accounts.profile(c.get("userId")), 200),
  );
  app.openapi(logoutRoute, async (c) => {
    await accounts.logout(c.get("installationId"));
    return c.json({ saved: true as const }, 200);
  });
  return app;
}
