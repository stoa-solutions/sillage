import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonResponse,
  operation,
  savedBody,
} from "../../shared/openapi.ts";
import { accountBody, claimLibraryInput } from "./accounts.schemas.ts";
import { accountsService } from "./accounts.service.ts";

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
const claimRoute = createRoute({
  method: "post",
  path: "/account/claim-library",
  ...operation({
    operationId: "claimLegacyLibrary",
    tag: TAG,
    summary: "Récupérer la bibliothèque historique",
    effect: "write",
    description:
      "Transfert à usage unique vers un compte Google, avec preuve du jeton historique. Transfère aussi l’historique et les jetons concernés. Ne sert pas à partager des bibliothèques entre comptes ordinaires.",
    example: { legacyToken: "{{legacy_token}}" },
  }),
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: claimLibraryInput,
          example: { legacyToken: "{{legacy_token}}" },
        },
      },
    },
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(savedBody, "Réponse réussie"),
    403: errorResponse("Transfert déjà effectué ou preuve invalide"),
  },
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
  app.openapi(claimRoute, async (c) => {
    const { legacyToken } = c.req.valid("json");
    return (await accounts.claimLibrary(c.get("userId"), legacyToken))
      ? c.json({ saved: true as const }, 200)
      : c.json(
          { error: "Bibliothèque déjà transférée ou preuve invalide." },
          403,
        );
  });
  return app;
}
