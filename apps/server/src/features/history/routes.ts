import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
} from "../../shared/openapi.ts";
import {
  deletedBody,
  historyEventsBody,
  historyPage,
  historyUpload,
  recordedBody,
} from "./contracts.ts";
import { clearHistory, listEvents, recordEvents } from "./store.ts";

// Listening history: what each account played and how it ended. Title and channel are copied
// because a played YouTube video need not be in the library. Read back by the Discover home.
const TAG = "Historique";
const example = {
  events: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      videoId: "video000001",
      title: "Titre de test",
      channel: "Artiste de test",
      outcome: "finished",
      playedAt: "2026-10-26T09:00:00Z",
    },
  ],
};
const recordRoute = createRoute({
  method: "post",
  path: "/",
  ...operation({
    operationId: "recordListeningEvents",
    tag: TAG,
    summary: "Enregistrer des écoutes",
    description:
      "1 à 100 événements par lot. L’identifiant UUID de chaque événement rend les réémissions idempotentes pour ce compte. finished, skipped, unavailable et replaced sont conservés ; pas de suivi audio implicite.",
    effect: "write",
    example,
  }),
  request: { body: jsonBody(historyUpload, example) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(recordedBody, "Réponse réussie"),
  },
});
const listRoute = createRoute({
  method: "get",
  path: "/",
  ...operation({
    operationId: "listListeningEvents",
    tag: TAG,
    summary: "Lire l’historique",
    description:
      "Tri décroissant par playedAt et id. Pagination par curseur : reprendre playedAt et id de la dernière ligne dans before et beforeId. beforeId exige before. Valeur par défaut : 50 ; maximum : 200.",
  }),
  request: { query: historyPage },
  responses: {
    ...commonErrors(),
    200: jsonResponse(historyEventsBody, "Réponse réussie"),
  },
});
const clearRoute = createRoute({
  method: "delete",
  path: "/",
  ...operation({
    operationId: "clearListeningHistory",
    tag: TAG,
    summary: "Effacer l’historique du compte",
    description:
      "Supprime uniquement les événements d’écoute du compte courant ; cela réduit les signaux disponibles pour l’accueil Découvrir.",
    effect: "write",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(deletedBody, "Réponse réussie"),
  },
});

/** The account's listening history, under /v1/history. */
export function historyRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(recordRoute, async (c) => {
    const { events } = c.req.valid("json");
    return c.json(
      { recorded: await recordEvents(db.orm, c.get("userId"), events) },
      200,
    );
  });
  app.openapi(listRoute, async (c) => {
    const rows = await listEvents(db.orm, c.get("userId"), c.req.valid("query"));
    const events = rows.map((row) => ({
      ...row,
      playedAt: row.playedAt.toISOString(),
    }));
    return c.json({ events }, 200);
  });
  app.openapi(clearRoute, async (c) => {
    return c.json(
      { deleted: await clearHistory(db.orm, c.get("userId")) },
      200,
    );
  });
  return app;
}
