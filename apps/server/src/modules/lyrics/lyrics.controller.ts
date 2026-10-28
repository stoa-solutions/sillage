import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { LyricsSources } from "./lyrics.service.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
} from "../../shared/openapi.ts";
import { lyricsBody, lyricsOffsetInput, lyricsVideoParam } from "./lyrics.schemas.ts";
import { lyricsFor, setLyricsOffset } from "./lyrics.service.ts";

const TAG = "Paroles";
const notInLibrary = errorResponse("Vidéo absente de la bibliothèque");
const unknownVideo = errorResponse("Vidéo inconnue");

const getRoute = createRoute({
  method: "get",
  path: "/{videoId}",
  ...operation({
    operationId: "getLyrics",
    tag: TAG,
    summary: "Paroles du morceau",
    description:
      "Toute vidéo YouTube, dans la bibliothèque ou non. Sources dans l’ordre : LRCLIB (synchronisées), YouTube Music pour cette vidéo, lyrics.ovh ; résultat gardé pour tous les comptes (30 jours, 7 pour une absence). Le worker cherche à l’avance celles de la bibliothèque. Applique la correction personnelle. missing et unavailable sont des états métier en HTTP 200. 404 si le serveur ne sait pas quelle vidéo c’est.",
    effect: "provider",
  }),
  request: { params: lyricsVideoParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(lyricsBody, "Réponse réussie"),
    404: unknownVideo,
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

/** Lyrics of any video, synchronised when LRCLIB has them, under /v1/lyrics. */
export function lyricsRoutes(db: Database, sources: LyricsSources) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(getRoute, async (c) => {
    const { videoId } = c.req.valid("param");
    const lyrics = await lyricsFor(db, sources, c.get("userId"), videoId);
    return lyrics ? c.json(lyrics, 200) : c.json({ error: "Vidéo inconnue." }, 404);
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
