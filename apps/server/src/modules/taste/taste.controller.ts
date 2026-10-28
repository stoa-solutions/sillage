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
  feedbackBody,
  feedbackInput,
  tasteOverviewBody,
  tasteSettingsBody,
  tasteSettingsInput,
  videoIdParam,
} from "./taste.schemas.ts";
import { tasteService } from "./taste.service.ts";
import { TASTE_RULES } from "./taste.rules.ts";

const TAG = "Goût";
const getFeedbackRoute = createRoute({
  method: "get",
  path: "/feedback/{videoId}",
  ...operation({
    operationId: "getTrackFeedback",
    tag: TAG,
    summary: "Avis sur un titre",
    description: "👍 (like), 👎 (dislike) ou null pour ce titre et le compte courant.",
  }),
  request: { params: videoIdParam },
  responses: { ...commonErrors(), 200: jsonResponse(feedbackBody, "Réponse réussie") },
});
const feedbackExample = { value: "like" };
const setFeedbackRoute = createRoute({
  method: "put",
  path: "/feedback/{videoId}",
  ...operation({
    operationId: "setTrackFeedback",
    tag: TAG,
    summary: "Donner ou retirer un avis",
    description: `like remonte le titre dans les propositions ouvertes du DJ. dislike l’écarte des propositions pendant le délai du compte (${TASTE_RULES.dislikeDays.default} jours par défaut), puis son poids s’estompe ; le titre reste jouable s’il est demandé par son nom. none retire l’avis. Aucune playlist n’est modifiée.`,
    effect: "write",
    example: feedbackExample,
  }),
  request: { params: videoIdParam, body: jsonBody(feedbackInput, feedbackExample) },
  responses: { ...commonErrors(), 200: jsonResponse(feedbackBody, "Réponse réussie") },
});
const overviewRoute = createRoute({
  method: "get",
  path: "/overview",
  ...operation({
    operationId: "getTasteOverview",
    tag: TAG,
    summary: "Mon goût",
    description:
      "Ce que les écoutes et les avis du compte disent de son goût : totaux, artistes préférés (moyenne prudente par artiste) et chaque titre écouté ou noté avec sa catégorie (Coup de cœur, Souvent écouté, Déjà écouté, Peu accroché, Écarté pour l’instant) et son affinité de 0 à 100.",
  }),
  responses: { ...commonErrors(), 200: jsonResponse(tasteOverviewBody, "Réponse réussie") },
});
const getSettingsRoute = createRoute({
  method: "get",
  path: "/settings",
  ...operation({
    operationId: "getTasteSettings",
    tag: TAG,
    summary: "Réglages du goût",
    description: "Nombre de jours pendant lesquels un 👎 écarte un titre des propositions.",
  }),
  responses: { ...commonErrors(), 200: jsonResponse(tasteSettingsBody, "Réponse réussie") },
});
const settingsExample = { dislikeDays: TASTE_RULES.dislikeDays.default };
const saveSettingsRoute = createRoute({
  method: "put",
  path: "/settings",
  ...operation({
    operationId: "saveTasteSettings",
    tag: TAG,
    summary: "Régler le délai d’un 👎",
    description: `De ${TASTE_RULES.dislikeDays.min} à ${TASTE_RULES.dislikeDays.max} jours. Ensuite, le poids du 👎 baisse de moitié à chaque nouveau délai.`,
    effect: "write",
    example: settingsExample,
  }),
  request: { body: jsonBody(tasteSettingsInput, settingsExample) },
  responses: { ...commonErrors(), 200: jsonResponse(tasteSettingsBody, "Réponse réussie") },
});

/** The listener's taste, mounted under /v1/taste. */
export function tasteRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  const taste = tasteService(db);
  app.openapi(getFeedbackRoute, async (c) => {
    const { videoId } = c.req.valid("param");
    return c.json({ videoId, value: await taste.feedback(c.get("userId"), videoId) }, 200);
  });
  app.openapi(setFeedbackRoute, async (c) => {
    const { videoId } = c.req.valid("param");
    const { value } = c.req.valid("json");
    const saved = value === "none" ? null : value;
    await taste.setFeedback(c.get("userId"), videoId, saved);
    return c.json({ videoId, value: saved }, 200);
  });
  app.openapi(overviewRoute, async (c) =>
    c.json(await taste.overview(c.get("userId")), 200),
  );
  app.openapi(getSettingsRoute, async (c) =>
    c.json(await taste.settings(c.get("userId")), 200),
  );
  app.openapi(saveSettingsRoute, async (c) =>
    c.json(await taste.saveSettings(c.get("userId"), c.req.valid("json").dislikeDays), 200),
  );
  return app;
}
