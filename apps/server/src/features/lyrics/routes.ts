import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { LyricsSource } from "../../integrations/lrclib/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
} from "../../shared/openapi.ts";
import { lyricsBody, lyricsOffsetInput, lyricsVideoParam } from "./contracts.ts";
import { lyricsFor, setLyricsOffset } from "./lyrics.ts";

const TAG = "Paroles";
const notInLibrary = errorResponse("Vidéo absente de la bibliothèque");

const getRoute = createRoute({
  method: "get",
  path: "/{videoId}",
  ...operation({
    operationId: "getLyrics",
    tag: TAG,
    summary: "Paroles du morceau",
    description:
      "Réservé aux vidéos présentes dans les playlists du compte. Cherche/cache LRCLIB et applique la correction personnelle. missing et unavailable sont des états métier en HTTP 200. Le clic temporel et le rendu restent gérés par le lecteur Mac.",
    effect: "provider",
  }),
  request: { params: lyricsVideoParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(lyricsBody, "Réponse réussie"),
    404: notInLibrary,
  },
});
const offsetRoute = createRoute({
  method: "post",
  path: "/{videoId}/offset",
  ...operation({
    operationId: "saveLyricsOffset",
    tag: TAG,
    summary: "Caler les paroles",
    description:
      "Correction personnelle en millisecondes, entre −30 000 et +30 000. Une valeur positive retarde les paroles. Ne modifie pas les corrections des autres comptes.",
    effect: "write",
    example: { offsetMs: 0 },
  }),
  request: {
    params: lyricsVideoParam,
    body: jsonBody(lyricsOffsetInput, { offsetMs: 0 }),
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(lyricsOffsetInput, "Réponse réussie"),
    404: notInLibrary,
  },
});

/** Synchronised lyrics of the account's videos, under /v1/lyrics. */
export function lyricsRoutes(db: Database, source: LyricsSource) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(getRoute, async (c) => {
    const { videoId } = c.req.valid("param");
    const lyrics = await lyricsFor(db, source, c.get("userId"), videoId);
    return lyrics
      ? c.json(lyrics, 200)
      : c.json({ error: "Vidéo absente de ta bibliothèque." }, 404);
  });
  app.openapi(offsetRoute, async (c) => {
    const { videoId } = c.req.valid("param");
    const { offsetMs } = c.req.valid("json");
    return (await setLyricsOffset(db, c.get("userId"), videoId, offsetMs))
      ? c.json({ offsetMs }, 200)
      : c.json({ error: "Vidéo absente de ta bibliothèque." }, 404);
  });
  return app;
}
