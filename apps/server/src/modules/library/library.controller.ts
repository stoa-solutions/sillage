import { createRoute, z } from "@hono/zod-openapi";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
} from "../../shared/openapi.ts";
import {
  addPlaylistInput,
  libraryExportBody,
  libraryStatusBody,
  playlistAcceptedBody,
  playlistIdParam,
  playlistsBody,
  removedBody,
  syncAcceptedBody,
} from "./library.schemas.ts";
import { libraryService } from "./library.service.ts";

const TAG = "Bibliothèque";
const notFollowed = errorResponse("Playlist inconnue pour ce compte");

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  ...operation({
    operationId: "getLibraryStatus",
    tag: TAG,
    summary: "État de la bibliothèque et du worker",
    description:
      "Compteurs de vidéos, index et tâches visibles pour le compte courant. Les tâches des autres comptes ne sont pas listées.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(libraryStatusBody, "Réponse réussie"),
  },
});
const listRoute = createRoute({
  method: "get",
  path: "/playlists",
  ...operation({
    operationId: "listPlaylists",
    tag: TAG,
    summary: "Playlists du compte",
    description:
      "Instantanés des playlists rattachées au compte et nombre d’entrées actives. Ce ne sont pas des droits d’écriture sur YouTube.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(playlistsBody, "Réponse réussie"),
  },
});
const addRoute = createRoute({
  method: "post",
  path: "/playlists",
  ...operation({
    operationId: "importYouTubePlaylist",
    tag: TAG,
    summary: "Importer une playlist par lien",
    description:
      "Ajoute le rattachement au compte puis programme une synchronisation. 202 signifie tâche créée, pas import terminé. Playlists publiques ou non répertoriées ; pas d’OAuth YouTube. Un import incomplet conserve l’instantané précédent.",
    effect: "write",
    example: { url: "https://www.youtube.com/playlist?list={{playlist_id}}" },
  }),
  request: {
    body: jsonBody(addPlaylistInput, {
      url: "https://www.youtube.com/playlist?list={{playlist_id}}",
    }),
  },
  responses: {
    ...commonErrors(),
    202: jsonResponse(playlistAcceptedBody, "Réponse réussie"),
  },
});
const removeRoute = createRoute({
  method: "delete",
  path: "/playlists/{id}",
  ...operation({
    operationId: "removePlaylist",
    tag: TAG,
    summary: "Retirer une playlist du compte",
    description:
      "Retire uniquement le rattachement Sillage du compte courant. Ne supprime rien sur YouTube ni chez les autres comptes. Les morceaux restent accessibles si une autre playlist du compte les contient. Retirer Mes découvertes vide cette collection privée.",
    effect: "write",
  }),
  request: { params: playlistIdParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(removedBody, "Réponse réussie"),
    404: notFollowed,
  },
});
const syncRoute = createRoute({
  method: "post",
  path: "/playlists/{id}/sync",
  ...operation({
    operationId: "syncYouTubePlaylist",
    tag: TAG,
    summary: "Actualiser une playlist YouTube",
    description:
      "Programme une synchronisation idempotente. Lire ensuite les tâches et la liste de playlists pour vérifier l’achèvement. Ne pas appeler pour Mes découvertes, qui n’a pas de source YouTube.",
    effect: "write",
  }),
  request: {
    // parsePlaylistId explains a malformed id; no length check before it.
    params: z.object({
      id: z.string().openapi({
        param: { name: "id", in: "path" },
        description: "Identifiant d’une playlist YouTube déjà rattachée au compte",
      }),
    }),
  },
  responses: {
    ...commonErrors(),
    202: jsonResponse(syncAcceptedBody, "Réponse réussie"),
    404: notFollowed,
  },
});
const exportRoute = createRoute({
  method: "get",
  path: "/export",
  ...operation({
    operationId: "exportLibrary",
    tag: TAG,
    summary: "Exporter la bibliothèque",
    description:
      "Export Sillage JSON version 1 au format collections/playlist/videos, limité au compte. Aucun jeton ni clé Gemini n’est inclus.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(libraryExportBody, "Réponse réussie"),
  },
});
/** The account's library: playlists it follows, their status and export. Under /v1. */
export function libraryRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  const library = libraryService(db);
  app.openapi(statusRoute, async (c) =>
    c.json(await library.status(c.get("userId")), 200),
  );
  app.openapi(listRoute, async (c) =>
    c.json({ playlists: await library.playlists(c.get("userId")) }, 200),
  );
  app.openapi(addRoute, async (c) =>
    c.json(await library.follow(c.get("userId"), c.req.valid("json").url), 202),
  );
  app.openapi(removeRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await library.unfollow(c.get("userId"), id)))
      return c.json({ error: "Playlist inconnue." }, 404);
    return c.json({ removed: id }, 200);
  });
  app.openapi(syncRoute, async (c) => {
    const job = await library.requestSync(
      c.get("userId"),
      c.req.valid("param").id,
    );
    if (!job) return c.json({ error: "Playlist inconnue." }, 404);
    return c.json({ job }, 202);
  });
  app.openapi(exportRoute, async (c) =>
    c.json(libraryExportBody.parse(await library.export(c.get("userId"))), 200),
  );
  return app;
}
