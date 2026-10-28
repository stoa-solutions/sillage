import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Video } from "@sillage/core/types";
import type { Database } from "../../db/index.ts";
import { MusicBrainzClient } from "../../integrations/musicbrainz/index.ts";
import { normalizeMusic } from "../search/index.ts";
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

type Credit = { artist: { id: string; name: string } };
/**
 * What « Pour toi » asks MusicBrainz, a few new requests per page: the gate allows one per
 * second for every worker, while a cached answer is free. A failed or skipped request only
 * leaves an artist out, without warning.
 */
function musicBrainzLinks(musicBrainz: Pick<MusicBrainzClient, "get" | "cached">) {
  let left = MUSICBRAINZ_REQUESTS;
  const ask = async <T>(path: string, params: Record<string, string>) => {
    try {
      if (!(await musicBrainz.cached(path, params))) {
        if (left <= 0) return undefined;
        left--;
      }
      return await musicBrainz.get<T>(path, params);
    } catch {
      return undefined;
    }
  };
  return {
    /** An artist known only by name: MusicBrainz's best match, when its name is the same. */
    artistId: async (name: string) => {
      const found = await ask<{ artists?: { id: string; name: string; score?: number }[] }>("artist", {
        query: `artist:"${name.replace(/["\\]/g, " ")}"`,
        limit: "1",
      });
      const best = found?.artists?.[0];
      return best && (best.score ?? 0) >= 95 && normalizeMusic(best.name) === normalizeMusic(name)
        ? best.id
        : undefined;
    },
    collaborators: async (mbid: string) => {
      const found = await ask<{ recordings?: { "artist-credit"?: Credit[] }[] }>("recording", {
        query: `arid:${mbid}`,
        limit: "100",
      });
      const counts = new Map<string, { mbid: string; name: string; score: number }>();
      for (const recording of found?.recordings ?? [])
        for (const { artist } of recording["artist-credit"] ?? []) {
          if (artist.id === mbid) continue;
          const entry = counts.get(artist.id) ?? { mbid: artist.id, name: artist.name, score: 0 };
          entry.score++;
          counts.set(artist.id, entry);
        }
      return [...counts.values()].sort((a, b) => b.score - a.score);
    },
    tagged: async (genre: string) => {
      const found = await ask<{ artists?: { id: string; name: string; score?: number }[] }>("artist", {
        query: `tag:"${genre.replace(/["\\]/g, " ")}"`,
        limit: "25",
      });
      return (found?.artists ?? []).map((artist) => ({
        mbid: artist.id,
        name: artist.name,
        score: artist.score ?? 0,
      }));
    },
  };
}
const MUSICBRAINZ_REQUESTS = 8;

/** Search and save YouTube music outside the library, under /v1/discover. */
const HOME_TTL = 20 * 60 * 1000;
/** An artist's catalog barely moves in a day, and YouTube throttles bursts of searches. */
const ARTIST_PAGE_TTL = 24 * 60 * 60 * 1000;

export function discoveryRoutes(
  db: Database,
  service: Discovery = discoveryFor(db),
  neighbours: Pick<ListenBrainz, "similar"> = listenBrainz,
  musicBrainz: Pick<MusicBrainzClient, "get" | "cached"> = new MusicBrainzClient(db),
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
        ...musicBrainzLinks(musicBrainz),
        search: (owner, query) => service.search(owner, query, "", ARTIST_PAGE_TTL),
        cached: (query) => service.cached(query),
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
