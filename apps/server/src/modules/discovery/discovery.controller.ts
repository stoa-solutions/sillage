import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Video } from "@sillage/core/types";
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
  discoveryAddInput,
  discoveryHomeBody,
  discoveryInput,
  discoveryPageBody,
  discoverySavedBody,
} from "./discovery.schemas.ts";
import { listenBrainz, type ListenBrainz } from "../../integrations/listenbrainz/index.ts";
import { tasteService } from "../taste/index.ts";
import { discoveryHome, listenerProfile } from "./discovery-home.service.ts";
import { historySize, knownVideos, recentListening } from "./discovery.repository.ts";
import { Discovery, DiscoveryError, discoveryFor } from "./discovery.service.ts";

const TAG = "Découvrir";
const unavailable = {
  502: errorResponse("Fournisseur temporairement indisponible"),
  503: errorResponse("Configuration ou service indisponible"),
};
const homeRoute = createRoute({
  method: "get",
  path: "/home",
  ...operation({
    operationId: "getDiscoveryHome",
    tag: TAG,
    summary: "Suggestions selon le goût et l’historique",
    description:
      "Rayons « Pour toi » : voisins d’écoute ListenBrainz des artistes préférés (Mon goût) et récents, hors de tout artiste de la bibliothèque et des écoutes ; genres de la bibliothèque sans les artistes habituels ; nouveaux titres des artistes récents. Écarte les vidéos possédées ou écoutées. Sans appel IA. Gardé 20 minutes par compte ; refresh=true tire d’autres voisins. ideas : genres de la bibliothèque, pour les envies.",
    effect: "provider",
  }),
  request: { query: z.object({ refresh: z.enum(["true", "false"]).optional() }) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoveryHomeBody, "Réponse réussie"),
    ...unavailable,
  },
});
const searchRoute = createRoute({
  method: "post",
  path: "/search",
  ...operation({
    operationId: "searchYouTube",
    tag: TAG,
    summary: "Chercher des morceaux sur YouTube",
    description:
      "SearXNG privé si configuré, sinon YouTube search.list. Les vidéos sont vérifiées par YouTube ; inLibrary est recalculé pour chaque compte. Cache public des requêtes de 5 minutes, maximum 100 entrées ; demandes identiques partagées, 4 recherches distinctes simultanées. pageToken est opaque et doit être renvoyé tel quel.",
    effect: "provider",
    example: { query: "Mac Miller", pageToken: "" },
  }),
  request: {
    body: jsonBody(discoveryInput, { query: "Mac Miller", pageToken: "" }),
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoveryPageBody, "Réponse réussie"),
    ...unavailable,
    429: errorResponse(
      "Quota, budget ou recherche occupée ; reason et retryAt précisent la limite",
    ),
  },
});
const addRoute = createRoute({
  method: "post",
  path: "/add",
  ...operation({
    operationId: "saveDiscovery",
    tag: TAG,
    summary: "Ajouter à Mes découvertes",
    description:
      "Revérifie l’identifiant sur YouTube, enregistre dans la collection privée du compte, puis programme les index texte et image si activés. Ajout idempotent. Ne modifie aucune playlist YouTube. L’enrichissement MusicBrainz est ensuite pris en charge par le worker pour les comptes activés.",
    effect: "write",
    example: { videoId: "{{video_id}}" },
  }),
  request: { body: jsonBody(discoveryAddInput, { videoId: "{{video_id}}" }) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoverySavedBody, "Réponse réussie"),
    ...unavailable,
    404: errorResponse("Vidéo absente ou inaccessible"),
  },
});

/** YouTube's titles are never empty; the track contract requires one. */
const asTrack = <T extends Video>(video: T) => ({
  ...video,
  title: video.title ?? "",
});

/** Search and save YouTube music outside the library, under /v1/discover. */
const HOME_TTL = 20 * 60 * 1000;

export function discoveryRoutes(
  db: Database,
  service: Discovery = discoveryFor(db),
  neighbours: Pick<ListenBrainz, "similar"> = listenBrainz,
) {
  const app = featureRouter<ApiEnvironment>("Recherche ou vidéo invalide.");
  // One page per account, kept briefly: a home costs a few dozen catalog searches.
  const homes = new Map<string, { until: number; plays: number; body: unknown }>();
  app.openapi(homeRoute, async (c) => {
    const user = c.get("userId");
    const refresh = c.req.valid("query").refresh === "true";
    // A deleted history makes a kept page stale; new plays wait for the next one.
    const plays = await historySize(db.orm, user);
    const kept = homes.get(user);
    if (!refresh && kept && kept.until > Date.now() && plays >= kept.plays)
      return c.json(kept.body as never, 200);
    const home = await discoveryHome(
      {
        history: (owner) => recentListening(db.orm, owner),
        profile: async (owner) =>
          listenerProfile(
            await knownVideos(db.orm, owner),
            (await tasteService(db).overview(owner)).artists,
          ),
        similar: (mbid) => neighbours.similar(mbid),
        search: (owner, query) => service.search(owner, query),
      },
      user,
      { rotate: refresh },
    );
    const track = <T extends { video: Video }>(item: T) => ({ ...item, video: asTrack(item.video) });
    const body = {
      ...home,
      sections: home.sections.map((section) => ({ ...section, items: section.items.map(track) })),
      suggestions: home.suggestions.map(track),
    };
    if (homes.size >= 200) homes.delete(homes.keys().next().value!);
    homes.set(user, { until: Date.now() + HOME_TTL, plays, body });
    return c.json(body, 200);
  });
  app.openapi(searchRoute, async (c) => {
    const input = c.req.valid("json");
    const page = await service.search(
      c.get("userId"),
      input.query,
      input.pageToken,
    );
    return c.json(
      {
        ...page,
        results: page.results.map((item) => ({
          ...item,
          video: asTrack(item.video),
        })),
      },
      200,
    );
  });
  app.openapi(addRoute, async (c) => {
    const { videoId } = c.req.valid("json");
    return c.json(await service.add(c.get("userId"), videoId), 200);
  });
  app.onError((error, c) => {
    if (
      error instanceof z.ZodError ||
      (error instanceof HTTPException && [400, 415].includes(error.status))
    )
      return c.json({ error: "Recherche ou vidéo invalide." }, 400);
    if (error instanceof DiscoveryError)
      return c.json(
        {
          error: error.message,
          source: "youtube",
          reason: error.reason,
          ...(error.retryAt ? { retryAt: error.retryAt } : {}),
        },
        error.status,
      );
    return c.json(
      { error: "L’ajout n’a pas abouti. Réessaie sans risque de doublon." },
      500,
    );
  });
  return app;
}
