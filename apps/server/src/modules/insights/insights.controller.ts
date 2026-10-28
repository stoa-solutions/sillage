import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import { commonErrors, featureRouter, jsonResponse, operation } from "../../shared/openapi.ts";
import { artistProfileBody, artistQuery, videoInsightsBody, videoParam, videoQuery } from "./insights.schemas.ts";
import { artistProfile, videoInsights, type InsightsSources } from "./insights.service.ts";

const TAG = "Autour du morceau";

const artistRoute = createRoute({
  method: "get",
  path: "/artist",
  ...operation({
    operationId: "getArtistProfile",
    tag: TAG,
    summary: "Fiche d’un artiste",
    description:
      "Images, audience, sorties et artistes proches (YouTube Music, nom identique uniquement), faits et genres (MusicBrainz), biographie (Wikipedia, français puis anglais, via Wikidata quand MusicBrainz le relie). Gardée 7 jours pour tous les comptes, 1 jour si rien n’est trouvé ; jamais gardée si une source a échoué. found=false : aucune source ne connaît ce nom.",
    effect: "provider",
  }),
  request: { query: artistQuery },
  responses: { ...commonErrors(), 200: jsonResponse(artistProfileBody, "Réponse réussie") },
});
const videoRoute = createRoute({
  method: "get",
  path: "/video/{videoId}",
  ...operation({
    operationId: "getVideoInsights",
    tag: TAG,
    summary: "Ce qu’on dit du morceau",
    description:
      "Vues, j’aime et commentaires les mieux classés par YouTube (API officielle, 2 unités de quota), et l’article Wikipedia du morceau quand artist et title permettent de le trouver. Gardé 1 jour pour tous les comptes.",
    effect: "provider",
  }),
  request: { params: videoParam, query: videoQuery },
  responses: { ...commonErrors(), 200: jsonResponse(videoInsightsBody, "Réponse réussie") },
});

/** Around what is playing: the artist's page and what people say, under /v1/insights. */
export function insightsRoutes(db: Database, sources: InsightsSources) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(artistRoute, async (c) => c.json(await artistProfile(db, sources, c.req.valid("query").name), 200));
  app.openapi(videoRoute, async (c) =>
    c.json(await videoInsights(db, sources, c.req.valid("param").videoId, c.req.valid("query")), 200),
  );
  return app;
}
