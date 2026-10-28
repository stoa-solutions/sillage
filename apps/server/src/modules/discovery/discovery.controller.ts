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
import {
  discoveryArtist,
  discoveryHome,
  discoveryScene,
  listenerProfile,
} from "./discovery-home.service.ts";
import { historySize, knownVideos, libraryWithPlays, recentListening } from "./discovery.repository.ts";
import { ownTracksOf } from "./discovery-artist.ts";
import { trackBody } from "../library/index.ts";
import type { HomeSources } from "./discovery-home.service.ts";
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
      "Rayons « Pour toi » : voisins d’écoute ListenBrainz des artistes préférés (Mon goût) et les plus écoutés, hors de tout artiste de la bibliothèque et des écoutes ; pour un artiste confidentiel, ses collaborations puis sa scène (MusicBrainz) ; un pas plus loin ; nouveaux titres des artistes récents. Écarte les vidéos possédées ou écoutées. Sans appel IA. Gardé 20 minutes par compte ; refresh=true tire d’autres voisins. scenes et artists : ce que la personne peut explorer ensuite.",
    effect: "provider",
  }),
  request: { query: z.object({ refresh: z.enum(["true", "false"]).optional() }) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoveryHomeBody, "Réponse réussie"),
    ...unavailable,
  },
});
const sceneRoute = createRoute({
  method: "get",
  path: "/scene",
  ...operation({
    operationId: "getDiscoveryScene",
    tag: TAG,
    summary: "Explorer une scène",
    description:
      "Artistes que MusicBrainz range dans ce genre et que la personne n’a pas encore, avec leurs titres. Mêmes exclusions et même budget de recherche que « Pour toi ». Gardé 20 minutes par compte et par scène ; refresh=true tire d’autres artistes.",
    effect: "provider",
    example: { genre: "digital cumbia" },
  }),
  request: {
    query: z.object({
      genre: z.string().trim().min(2).max(80),
      refresh: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoveryHomeBody, "Réponse réussie"),
    ...unavailable,
  },
});
const artistRoute = createRoute({
  method: "get",
  path: "/artist",
  ...operation({
    operationId: "getDiscoveryArtist",
    tag: TAG,
    summary: "Explorer autour d’un artiste",
    description:
      "Ses titres absents de la bibliothèque, ses voisins d’écoute ListenBrainz, les artistes avec qui il a enregistré (MusicBrainz), puis un pas plus loin. Gardé 20 minutes par compte et par artiste ; refresh=true tire d’autres artistes.",
    effect: "provider",
    example: { name: "Acid Coco" },
  }),
  request: {
    query: z.object({
      name: z.string().trim().min(1).max(120),
      refresh: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(discoveryHomeBody, "Réponse réussie"),
    ...unavailable,
  },
});
const ownRoute = createRoute({
  method: "get",
  path: "/artist/library",
  ...operation({
    operationId: "getArtistInLibrary",
    tag: TAG,
    summary: "Ses titres dans ta bibliothèque",
    description:
      "Les titres de la bibliothèque crédités à cet artiste (artiste principal, ou invité selon MusicBrainz), les plus écoutés d’abord, avec le nombre d’écoutes du compte. 50 au plus.",
    example: { name: "Mac Miller" },
  }),
  request: { query: z.object({ name: z.string().trim().min(1).max(120) }) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(
      z.object({ tracks: z.array(z.object({ video: trackBody, plays: z.number().int() })) }).openapi("ArtistInLibrary"),
      "Réponse réussie",
    ),
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
        limit: "100",
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

export function discoveryRoutes(
  db: Database,
  service: Discovery = discoveryFor(db),
  neighbours: Pick<ListenBrainz, "similar"> = listenBrainz,
  musicBrainz: Pick<MusicBrainzClient, "get" | "cached"> = new MusicBrainzClient(db),
) {
  const app = featureRouter<ApiEnvironment>("Recherche ou vidéo invalide.");
  // One page per account and place, kept briefly: a page costs a few dozen catalog searches.
  const pages = new Map<string, { until: number; plays: number; body: unknown }>();
  const sources = {
    history: (owner: string) => recentListening(db.orm, owner),
    profile: async (owner: string) =>
      listenerProfile(await knownVideos(db.orm, owner), (await tasteService(db).overview(owner)).artists),
    similar: (mbid: string) => neighbours.similar(mbid),
    // An artist's songs from YouTube Music: credited, without mixes, and spares SearXNG.
    search: (owner: string, artist: string) => service.songs(owner, artist),
    cached: (artist: string) => service.songsCached(artist),
  };
  const track = <T extends { video: Video }>(item: T) => ({ ...item, video: asTrack(item.video) });
  /** Serves a kept page, or builds it; a deleted history makes a kept page stale. */
  const kept = async (
    user: string,
    place: string,
    refresh: boolean,
    build: (given: HomeSources) => Promise<Awaited<ReturnType<typeof discoveryHome>>>,
  ) => {
    const key = `${user}\n${place}`;
    const plays = await historySize(db.orm, user);
    const page = pages.get(key);
    if (!refresh && page && page.until > Date.now() && plays >= page.plays) return page.body as never;
    const result = await build({ ...sources, ...musicBrainzLinks(musicBrainz) });
    const body = {
      ...result,
      sections: result.sections.map((section) => ({ ...section, items: section.items.map(track) })),
      suggestions: result.suggestions.map(track),
    };
    if (pages.size >= 500) pages.delete(pages.keys().next().value!);
    pages.set(key, { until: Date.now() + HOME_TTL, plays, body });
    return body;
  };
  app.openapi(homeRoute, async (c) => {
    const user = c.get("userId");
    const rotate = c.req.valid("query").refresh === "true";
    return c.json(await kept(user, "home", rotate, (given) => discoveryHome(given, user, { rotate })), 200);
  });
  app.openapi(sceneRoute, async (c) => {
    const user = c.get("userId");
    const { genre, refresh } = c.req.valid("query");
    const rotate = refresh === "true";
    return c.json(
      await kept(user, "scene:" + genre.toLowerCase(), rotate, (given) =>
        discoveryScene(given, user, genre, { rotate }),
      ),
      200,
    );
  });
  app.openapi(artistRoute, async (c) => {
    const user = c.get("userId");
    const { name, refresh } = c.req.valid("query");
    const rotate = refresh === "true";
    return c.json(
      await kept(user, "artist:" + name.toLowerCase(), rotate, (given) =>
        discoveryArtist(given, user, name, { rotate }),
      ),
      200,
    );
  });
  app.openapi(ownRoute, async (c) => {
    const { name } = c.req.valid("query");
    const owned = ownTracksOf(await libraryWithPlays(db.orm, c.get("userId")), name);
    return c.json(
      {
        tracks: owned.map(({ plays, ...video }) => ({
          video: {
            id: video.id,
            title: video.title ?? "",
            channel: video.channel,
            durationSeconds: video.durationSeconds,
            thumbnailUrl: video.thumbnailUrl,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            musicMetadata: (video.musicMetadata as never) ?? null,
          },
          plays: Number(plays),
        })),
      },
      200,
    );
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
