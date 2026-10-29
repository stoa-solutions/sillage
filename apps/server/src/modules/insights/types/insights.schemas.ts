import { z } from "@hono/zod-openapi";

export const artistQuery = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .openapi({ param: { name: "name", in: "query" }, description: "Nom de l’artiste, tel qu’affiché" }),
});
export const videoParam = z.object({
  videoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .openapi({ param: { name: "videoId", in: "path" }, description: "Vidéo YouTube, dans la bibliothèque ou non" }),
});
export const videoQuery = z.object({
  artist: z
    .string()
    .trim()
    .max(200)
    .optional()
    .openapi({ param: { name: "artist", in: "query" }, description: "Artiste, pour trouver l’article du morceau" }),
  title: z
    .string()
    .trim()
    .max(300)
    .optional()
    .openapi({ param: { name: "title", in: "query" }, description: "Titre du morceau, sans l’artiste" }),
});

const link = z.string().url().nullable();
export const albumParam = z.object({
  browseId: z
    .string()
    .regex(/^MPRE[\w-]{5,40}$/)
    .openapi({ param: { name: "browseId", in: "path" }, description: "Album YouTube Music (MPREb_…)" }),
});
export const searchQuery = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .openapi({ param: { name: "query", in: "query" }, description: "Ce que la personne tape" }),
});
export const albumBody = z
  .object({
    browseId: z.string(),
    title: z.string(),
    artist: z.string().nullable(),
    kind: z.string(),
    year: z.string().nullable(),
    summary: z.string().nullable(),
    description: z.string().nullable(),
    artwork: z.string().url().nullable(),
    tracks: z.array(
      z.object({
        videoId: z.string(),
        title: z.string(),
        position: z.number().int(),
        durationSeconds: z.number().int().nullable(),
        plays: z.string().nullable(),
        inLibrary: z.boolean(),
      }),
    ),
  })
  .openapi("Album");
export const artistHitsBody = z
  .object({
    artists: z.array(
      z.object({ browseId: z.string(), name: z.string(), portrait: z.string().url().nullable(), audience: z.string().nullable() }),
    ),
  })
  .openapi("ArtistSearch");
export const artistProfileBody = z
  .object({
    name: z.string(),
    description: z.string().nullable().openapi({ description: "Ligne d’en-tête Wikipedia, ex. « groupe de rock américain »" }),
    bio: z.object({ text: z.string(), source: z.string(), url: link }).nullable(),
    banner: link.openapi({ description: "Bannière large de YouTube Music" }),
    portrait: link,
    photo: link.openapi({ description: "Photo de l’article Wikipedia (Wikimedia Commons)" }),
    audience: z.string().nullable().openapi({ description: "Telle que YouTube Music la formule" }),
    kind: z.string().nullable(),
    origin: z.string().nullable(),
    active: z.string().nullable(),
    genres: z.array(z.string()),
    releases: z.array(
      z.object({
        browseId: z.string(),
        title: z.string(),
        kind: z.string(),
        year: z.string().nullable(),
        artwork: link,
      }),
    ),
    related: z.array(z.object({ name: z.string(), portrait: link })),
    links: z.object({ youtubeMusic: link, wikipedia: link, musicbrainz: link }),
    found: z.boolean(),
  })
  .openapi("ArtistProfile");
export const videoInsightsBody = z
  .object({
    views: z.number().int().nullable(),
    likes: z.number().int().nullable(),
    commentCount: z.number().int().nullable(),
    comments: z.array(
      z.object({
        author: z.string(),
        text: z.string(),
        likes: z.number().int(),
        publishedAt: z.string().nullable(),
      }),
    ),
    song: z
      .object({ title: z.string(), description: z.string().nullable(), text: z.string(), url: z.string().url() })
      .nullable(),
  })
  .openapi("VideoInsights");
