import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "../../db/index.ts";
import { MusicBrainzClient } from "../../integrations/musicbrainz/index.ts";
import { wikipedia } from "../../integrations/wikipedia/index.ts";
import { YouTube } from "../../integrations/youtube/index.ts";
import { artistKey, youTubeMusic } from "../../integrations/youtube-music/index.ts";
import type { CatalogArtist, InsightsSources } from "./insights.service.ts";

type Found = { artists?: { id: string; name: string; score?: number }[] };
type Detail = {
  id: string;
  type?: string | null;
  area?: { name?: string } | null;
  "begin-area"?: { name?: string } | null;
  "life-span"?: { begin?: string | null; end?: string | null };
  genres?: { name: string; count?: number }[];
  relations?: { type?: string; url?: { resource?: string } }[];
};

/** MusicBrainz's artist of exactly this name, with its genres and Wikidata link. */
export function catalogArtists(
  db: Database,
  fetcher?: typeof fetch,
  pause = 2_000,
): InsightsSources["catalog"] {
  const client = new MusicBrainzClient(db, fetcher);
  // MusicBrainz turns requests away when it is busy (HTTP 503): one more try after a pause.
  const mb = {
    get: async <T>(path: string, params: Record<string, string>) => {
      try {
        return await client.get<T>(path, params);
      } catch {
        await delay(pause);
        return client.get<T>(path, params);
      }
    },
  };
  return {
    async artist(name: string): Promise<CatalogArtist | null> {
      const found = await mb.get<Found>("artist", {
        query: `artist:"${name.replace(/["\\]/g, " ")}"`,
        limit: "5",
      });
      const best = (found.artists ?? []).find(
        (artist) => (artist.score ?? 0) >= 90 && artistKey(artist.name) === artistKey(name),
      );
      if (!best) return null;
      const detail = await mb.get<Detail>(`artist/${best.id}`, { inc: "genres+url-rels" });
      const wikidata = (detail.relations ?? [])
        .find((relation) => relation.type === "wikidata")
        ?.url?.resource?.match(/Q\d+$/)?.[0];
      return {
        id: detail.id,
        type: detail.type ?? null,
        area: detail.area?.name ?? null,
        beginArea: detail["begin-area"]?.name ?? null,
        begin: detail["life-span"]?.begin ?? null,
        end: detail["life-span"]?.end ?? null,
        genres: [...(detail.genres ?? [])]
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
          .map((genre) => genre.name),
        wikidata: wikidata ?? null,
      };
    },
  };
}

/** The sources in production; tests give their own. */
export function defaultInsightsSources(db: Database, given?: Partial<InsightsSources>): InsightsSources {
  const youtube = new YouTube(process.env["YOUTUBE_API_KEY"] ?? "", db);
  return {
    music: youTubeMusic,
    wikipedia,
    catalog: catalogArtists(db),
    youtube: {
      statistics: (id) => youtube.statistics(id),
      topComments: (id, count) => youtube.topComments(id, count),
    },
    ...given,
  };
}
