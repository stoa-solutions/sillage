import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonResponse,
  operation,
} from "../../shared/openapi.ts";
import { retriedBody } from "./jobs.schemas.ts";
import { jobsService } from "./jobs.service.ts";

const retryRoute = createRoute({
  method: "post",
  path: "/jobs/retry",
  ...operation({
    operationId: "retryFailedJobs",
    tag: "Maintenance",
    summary: "Relancer les tâches échouées",
    description:
      "Réservé au compte historique de maintenance. Relance les dernières tâches en échec sans dupliquer une tâche active. Opération globale de maintenance, pas une action de playlist ordinaire.",
    effect: "write",
  }),
  responses: {
    ...commonErrors(),
    202: jsonResponse(retriedBody, "Réponse réussie"),
    403: errorResponse("Maintenance uniquement"),
  },
});

/** Queue maintenance, under /v1. */
export function jobRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  const jobs = jobsService(db);
  app.openapi(retryRoute, async (c) => {
    const retried = await jobs.retryFailed(c.get("userId"));
    if (retried === null)
      return c.json({ error: "Action réservée à la maintenance." }, 403);
    return c.json({ retried }, 202);
  });
  return app;
}
