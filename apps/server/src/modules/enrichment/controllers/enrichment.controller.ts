import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../../db/index.ts";
import type { ApiEnvironment } from "../../../shared/api-environment.ts";
import {
  commonErrors,
  featureRouter,
  jsonResponse,
  operation,
} from "../../../shared/openapi.ts";
import { enrichmentBody } from "../types/enrichment.schemas.ts";
import { enrichmentProgressFor } from "../services/enrichment.service.ts";

const progressRoute = createRoute({
  method: "get",
  path: "/library/enrichment",
  ...operation({
    operationId: "getEnrichmentProgress",
    tag: "Bibliothèque",
    summary: "Avancement MusicBrainz",
    description:
      "Compteurs propres au compte : matched, ambiguous, not_found, attente YouTube, tâches et erreurs. processed indique une décision d’enrichissement, pas forcément une correspondance certaine. Les genres d’artiste ne prouvent pas le genre du morceau.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(enrichmentBody, "Réponse réussie"),
  },
});

/** MusicBrainz progress of the account's library, under /v1. */
export function enrichmentRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(progressRoute, async (c) =>
    c.json(await enrichmentProgressFor(db, c.get("userId")), 200),
  );
  return app;
}
