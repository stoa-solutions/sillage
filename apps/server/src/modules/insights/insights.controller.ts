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
import {
  albumBody,
  albumParam,
  artistHitsBody,
  artistProfileBody,
  artistQuery,
  searchQuery,
  videoInsightsBody,
  videoParam,
  videoQuery,
} from "./insights.schemas.ts";
import {
  albumPage,
  artistProfile,
  searchArtists,
  videoInsights,
  type InsightsSources,
} from "./insights.service.ts";

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

const albumRoute = createRoute({
  method: "get",
  path: "/album/{browseId}",
  ...operation({
    operationId: "getAlbum",
    tag: TAG,
    summary: "Un album et ses titres",
    description:
      "Pochette, artiste, année, description et titres jouables d’un album ou d’un single YouTube Music (gardé 30 jours pour tous les comptes) ; inLibrary dit si le compte a déjà chaque titre. 404 si ce n’est pas un album.",
    effect: "provider",
  }),
  request: { params: albumParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(albumBody, "Réponse réussie"),
    404: errorResponse("Album introuvable"),
  },
});
const searchRoute = createRoute({
  method: "get",
  path: "/artists",
  ...operation({
    operationId: "searchArtists",
    tag: TAG,
    summary: "Chercher un artiste",
    description: "Jusqu’à 6 artistes YouTube Music pour ce qui est tapé, avec portrait et audience. Gardé 1 jour par recherche.",
    effect: "provider",
  }),
  request: { query: searchQuery },
  responses: { ...commonErrors(), 200: jsonResponse(artistHitsBody, "Réponse réussie") },
});

/** Around what is playing: the artist's page and what people say, under /v1/insights. */
export function insightsRoutes(db: Database, sources: InsightsSources) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(artistRoute, async (c) => c.json(await artistProfile(db, sources, c.req.valid("query").name), 200));
  app.openapi(videoRoute, async (c) =>
    c.json(await videoInsights(db, sources, c.req.valid("param").videoId, c.req.valid("query")), 200),
  );
  app.openapi(albumRoute, async (c) => {
    const album = await albumPage(db, sources, c.get("userId"), c.req.valid("param").browseId);
    return album ? c.json(album, 200) : c.json({ error: "Album introuvable." }, 404);
  });
  app.openapi(searchRoute, async (c) =>
    c.json({ artists: await searchArtists(db, sources, c.req.valid("query").query) }, 200),
  );
  return app;
}
