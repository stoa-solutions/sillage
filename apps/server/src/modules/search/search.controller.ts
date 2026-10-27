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
import { librarySearchInput, searchPageBody } from "./search.schemas.ts";
import { search } from "./search.service.ts";

const example = {
  query: "Mac Miller",
  mode: "text",
  sort: "relevance",
  offset: 0,
  limit: 25,
};
const searchRoute = createRoute({
  method: "post",
  path: "/search",
  ...operation({
    operationId: "searchLibrary",
    tag: "Recherche",
    summary: "Chercher dans les playlists",
    description:
      "Recherche hybride lexicale/vectorielle et métadonnées MusicBrainz dans les appartenances actives du compte. mode=image rapproche les miniatures indexées. offset/limit paginent la bibliothèque ; un index indisponible peut fournir des résultats avec degraded. Aucun appel de recherche YouTube via cette route.",
    example,
  }),
  request: { body: jsonBody(librarySearchInput, example) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(searchPageBody, "Réponse réussie"),
  },
});

/** Library search of the account, under /v1. */
export function searchRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(searchRoute, async (c) =>
    c.json(await search(db, c.req.valid("json"), c.get("userId")), 200),
  );
  return app;
}
