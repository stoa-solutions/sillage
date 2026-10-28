import type { Database } from "../../db/index.ts";
import type { MusicArtist } from "../../integrations/youtube-music/index.ts";
import { artistKey } from "../../integrations/youtube-music/index.ts";
import type { WikiSummary } from "../../integrations/wikipedia/index.ts";
import { keep, kept } from "./insights.repository.ts";

/** What MusicBrainz knows of an artist of exactly this name. */
export interface CatalogArtist {
  id: string;
  type: string | null;
  area: string | null;
  beginArea: string | null;
  begin: string | null;
  end: string | null;
  genres: string[];
  wikidata: string | null;
}

export interface InsightsSources {
  music: { artist(name: string): Promise<MusicArtist | null> };
  wikipedia: {
    summary(lang: string, title: string): Promise<WikiSummary | null>;
    sitelinks(qid: string): Promise<{ lang: string; title: string }[]>;
    search(lang: string, query: string, limit?: number): Promise<string[]>;
  };
  catalog: { artist(name: string): Promise<CatalogArtist | null> };
  youtube: {
    statistics(id: string): Promise<{ views: number | null; likes: number | null; comments: number | null } | null>;
    topComments(id: string, count?: number): Promise<{ author: string; text: string; likes: number; publishedAt: string | null }[]>;
  };
}

export const INSIGHT_RULES = {
  /** An artist page changes slowly; a missing one may appear sooner. */
  artistDays: 7,
  missingArtistDays: 1,
  videoDays: 1,
  comments: 8,
};

/** Words that make a Wikipedia article about a musician rather than a namesake. */
const MUSICIAN =
  /musici|chanteu|chanteuse|rappeu|groupe|band|singer|rapper|producteur|producer|compositeu|composer|dj\b|duo|trio|orchestr|music|musique|auteur-compositeur|songwriter|beatmaker|ensemble|instrumentist|pianist|guitarist|saxophon|batteu|drummer/i;
const SONG = /chanson|single|song|titre|morceau|instrumental/i;

/** The first article that passes `fits`, French then English, from what `titles` proposes. */
async function firstFitting(
  wikipedia: InsightsSources["wikipedia"],
  candidates: { lang: string; title: string }[],
  fits: (summary: WikiSummary) => boolean,
) {
  for (const { lang, title } of candidates) {
    const summary = await wikipedia.summary(lang, title);
    if (summary && fits(summary)) return summary;
  }
  return null;
}

/** The artist's article: through Wikidata when MusicBrainz links one, otherwise a checked search. */
async function artistArticle(sources: InsightsSources, name: string, catalog: CatalogArtist | null) {
  if (catalog?.wikidata) {
    const linked = await sources.wikipedia.sitelinks(catalog.wikidata);
    const found = await firstFitting(sources.wikipedia, linked, () => true);
    if (found) return found;
  }
  const wanted = artistKey(name);
  for (const lang of ["fr", "en"]) {
    const titles = await sources.wikipedia.search(lang, name, 3);
    const found = await firstFitting(
      sources.wikipedia,
      titles.map((title) => ({ lang, title })),
      (summary) =>
        // « Phoenix (groupe) » is the band; « Phoenix (Arizona) » is not.
        artistKey(summary.title.replace(/\s*\(.*\)$/, "")) === wanted &&
        MUSICIAN.test(`${summary.description ?? ""} ${summary.extract.slice(0, 300)}`),
    );
    if (found) return found;
  }
  return null;
}

const year = (date: string | null) => date?.slice(0, 4) ?? null;

/** « Groupe · Seattle, United States · 1987 – 1994 », as separate facts. */
function facts(catalog: CatalogArtist | null) {
  if (!catalog) return { kind: null, origin: null, active: null };
  const group = catalog.type === "Group";
  const origin = [catalog.beginArea, catalog.area].filter((place, index, all) => place && all.indexOf(place) === index);
  return {
    kind: group ? "Groupe" : catalog.type === "Person" ? "Artiste" : null,
    origin: origin.length ? origin.join(", ") : null,
    // A person's dates are a birth and a death, not a career: only bands get them.
    active: !group || !year(catalog.begin) ? null : year(catalog.end) ? `${year(catalog.begin)} – ${year(catalog.end)}` : `Depuis ${year(catalog.begin)}`,
  };
}

export type ArtistProfile = Awaited<ReturnType<typeof buildProfile>>;

async function buildProfile(sources: InsightsSources, name: string) {
  let failed = false;
  const settle = <T>(work: Promise<T>) =>
    work.catch(() => {
      failed = true;
      return null;
    });
  const [music, catalog] = await Promise.all([settle(sources.music.artist(name)), settle(sources.catalog.artist(name))]);
  const article = await settle(artistArticle(sources, name, catalog));
  const bio = article
    ? { text: article.extract, source: "Wikipedia", url: article.url }
    : music?.description
      ? { text: music.description, source: "YouTube Music", url: null }
      : null;
  return {
    profile: {
      name: music?.name ?? name,
      description: article?.description ?? null,
      bio,
      banner: music?.banner ?? null,
      portrait: music?.portrait ?? article?.image ?? null,
      photo: article?.image ?? null,
      audience: music?.audience ?? null,
      ...facts(catalog),
      genres: catalog?.genres.slice(0, 5) ?? [],
      releases: music?.releases ?? [],
      related: music?.related ?? [],
      links: {
        youtubeMusic: music ? `https://music.youtube.com/channel/${music.browseId}` : null,
        wikipedia: article?.url ?? null,
        musicbrainz: catalog ? `https://musicbrainz.org/artist/${catalog.id}` : null,
      },
      found: !!(music || catalog || article),
    },
    failed,
  };
}

/**
 * An artist's page from public sources, kept for every account: YouTube Music for pictures,
 * audience, releases and neighbours; MusicBrainz for facts and genres; Wikipedia for the bio.
 * An answer with a failed source is served but not kept.
 */
export async function artistProfile(db: Database, sources: InsightsSources, name: string) {
  const key = `artist:${artistKey(name)}`;
  const known = await kept(db, key, INSIGHT_RULES.artistDays);
  const value = known?.value as ArtistProfile["profile"] | undefined;
  if (value && (value.found || (await kept(db, key, INSIGHT_RULES.missingArtistDays)))) return value;
  const { profile, failed } = await buildProfile(sources, name);
  if (!failed) await keep(db, key, profile);
  return profile;
}

/**
 * What people make of a video: its numbers and the comments YouTube ranks first, and the
 * song's Wikipedia article when there is one. Kept a day for every account.
 */
export async function videoInsights(
  db: Database,
  sources: InsightsSources,
  videoId: string,
  song: { artist?: string | undefined; title?: string | undefined },
) {
  const key = `video:${videoId}`;
  const known = await kept(db, key, INSIGHT_RULES.videoDays);
  if (known) return known.value as Awaited<ReturnType<typeof buildVideo>>["insights"];
  const { insights, failed } = await buildVideo(sources, videoId, song);
  if (!failed) await keep(db, key, insights);
  return insights;
}

async function buildVideo(sources: InsightsSources, videoId: string, song: { artist?: string | undefined; title?: string | undefined }) {
  let failed = false;
  const settle = <T>(work: Promise<T>, fallback: T) =>
    work.catch(() => {
      failed = true;
      return fallback;
    });
  const [stats, comments, article] = await Promise.all([
    settle(sources.youtube.statistics(videoId), null),
    settle(sources.youtube.topComments(videoId, INSIGHT_RULES.comments), []),
    song.title && song.artist ? settle(songArticle(sources, song.artist, song.title), null) : Promise.resolve(null),
  ]);
  return {
    insights: {
      views: stats?.views ?? null,
      likes: stats?.likes ?? null,
      commentCount: stats?.comments ?? null,
      comments,
      song: article ? { title: article.title, description: article.description, text: article.extract, url: article.url } : null,
    },
    failed,
  };
}

/** The song's own article: a search on its title and artist, checked to be about a song. */
async function songArticle(sources: InsightsSources, artist: string, title: string) {
  const wanted = artistKey(title);
  if (wanted.length < 2) return null;
  for (const lang of ["fr", "en"]) {
    const titles = await sources.wikipedia.search(lang, `"${title}" ${artist}`, 3);
    const found = await firstFitting(
      sources.wikipedia,
      titles.map((title) => ({ lang, title })),
      (summary) =>
        artistKey(summary.title.replace(/\s*\(.*\)$/, "")) === wanted &&
        SONG.test(summary.description ?? "") &&
        artistKey(`${summary.description} ${summary.extract}`).includes(artistKey(artist)),
    );
    if (found) return found;
  }
  return null;
}
