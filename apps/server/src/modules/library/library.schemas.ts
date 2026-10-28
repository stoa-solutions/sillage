import { z } from "@hono/zod-openapi";
import { jobBody } from "../jobs/index.ts";

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

export const addPlaylistInput = z.object({ url: z.string().min(1).max(500) });
export const playlistIdParam = z.object({
  id: z.string().min(1).max(160).openapi({
    param: { name: "id", in: "path" },
    description: "Identifiant de playlist Sillage ou YouTube",
  }),
});

export const playlistBody = z
  .object({
    id: z.string(),
    title: z.string(),
    source_url: z.string(),
    created_at: z.iso.datetime().optional(),
    last_sync_at: z.iso.datetime().nullable().optional(),
    next_sync_at: z.iso.datetime().nullable().optional(),
    sync_enabled: z.boolean().optional(),
    generation: z.string().optional(),
    status: z.string().optional(),
    error: z.string().nullable().optional(),
    entries: z.number().int(),
  })
  .openapi("Playlist", {
    description:
      "Les champs de cette route historique utilisent snake_case. Les champs additionnels du suivi de synchronisation restent possibles.",
  });
export const playlistsBody = z.object({ playlists: z.array(playlistBody) });
export const syncAcceptedBody = z
  .object({ job: jobBody })
  .openapi("SyncAccepted");
export const playlistAcceptedBody = z
  .object({ id: z.string(), job: jobBody })
  .openapi("PlaylistAccepted");
export const removedBody = z.object({ removed: z.string() });

export const libraryStatusBody = z
  .object({
    counts: z.object({
      videos: z.number().int(),
      titled: z.number().int(),
      descriptions: z.number().int(),
      text_indexed: z.number().int(),
      images: z.number().int(),
    }),
    jobs: z.array(
      z.object({ kind: z.string(), status: z.string(), count: z.number().int() }),
    ),
    syncEnabled: z.boolean(),
    youtubeConfigured: z.boolean(),
    visionEnabled: z.boolean(),
  })
  .openapi("LibraryStatus");

const exportVideo = z
  .object({
    id: videoId,
    title: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    upload_date: z.string().nullable().optional(),
    position: z.number().int().optional(),
  })
  .openapi("ExportVideo");
const exportCollection = z
  .object({
    playlist: z.object({ id: z.string(), title: z.string() }).optional(),
    videos: z.array(exportVideo).max(50000),
  })
  .openapi("ExportCollection");
export const libraryExportBody = z
  .object({
    format: z.literal("sillage"),
    version: z.literal(1),
    collections: z.array(exportCollection),
  })
  .openapi("LibraryExport", {
    description:
      "Export Sillage normalisé ; aucune clé ni session n’est exportée.",
  });

/** Validated by parseImport from the shared core, which accepts three historical formats. */
export const libraryImportInput = z.unknown().openapi("LibraryImport", {
  description:
    "Export Sillage, playlist normalisée ou playlist plate yt-dlp. Au plus 100 playlists et 50 000 entrées au total ; max. 30 Mio. Réservé à la maintenance historique.",
  anyOf: [
    {
      type: "object",
      properties: {
        collections: {
          type: "array",
          items: { $ref: "#/components/schemas/ExportCollection" },
        },
      },
      required: ["collections"],
    },
    { $ref: "#/components/schemas/ExportCollection" },
    {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[A-Za-z0-9_-]{11}$" },
              duration: { anyOf: [{ type: "number" }, { type: "null" }] },
              title: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
            required: ["id"],
          },
        },
      },
      required: ["entries"],
    },
  ],
});
export const importedBody = z.object({
  playlists: z.number().int(),
  videos: z.number().int(),
});

/** MusicBrainz decision attached to a video; artist genres are not the song's genres. */
export const musicMetadataBody = z
  .object({
    source: z.literal("MusicBrainz"),
    status: z.enum(["matched", "ambiguous", "not_found"]),
    checkedAt: z.iso.datetime(),
    recordingId: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.string().optional(),
    artists: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.enum(["primary", "featured"]),
      }),
    ),
    albums: z.array(z.object({ id: z.string(), title: z.string() })),
    genres: z.array(z.string()),
    artistGenres: z.array(z.string()).openapi({
      description: "Genres de l’artiste, pas nécessairement ceux du morceau.",
    }),
    searchText: z.string(),
  })
  .openapi("MusicMetadata");

export const videoBody = z
  .object({
    id: videoId,
    title: z.string().nullable(),
    channel: z.string().nullable(),
    durationSeconds: z.number().int().nullable(),
    description: z.string(),
    tags: z.array(z.string()),
    thumbnailUrl: z.string(),
    url: z.string(),
    publishedAt: z.string().nullable(),
    channelAvatarUrl: z.string().nullable().optional(),
    musicMetadata: z.union([musicMetadataBody, z.null()]).optional(),
  })
  .openapi("Video");

/** The compact track shape shared by the DJ and Discover. */
export const trackBody = z
  .object({
    id: videoId,
    title: z.string(),
    channel: z.string().nullable().optional(),
    durationSeconds: z.number().int().nullable().optional(),
    url: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    musicMetadata: z.union([musicMetadataBody, z.null()]).optional(),
  })
  .openapi("DjTrack");
