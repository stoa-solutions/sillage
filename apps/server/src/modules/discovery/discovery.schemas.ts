import { z } from "@hono/zod-openapi";
import { trackBody, videoBody } from "../library/index.ts";

export const discoveryInput = z
  .object({
    query: z.string().trim().min(2).max(200),
    pageToken: z
      .string()
      .max(500)
      .regex(/^[\w=-]*$/)
      .default(""),
  })
  .openapi("DiscoverySearch");
export const discoveryAddInput = z
  .object({ videoId: z.string().regex(/^[\w-]{11}$/) })
  .openapi("DiscoveryAdd");

export const discoveryItemBody = z
  .object({ video: trackBody, inLibrary: z.boolean() })
  .openapi("DiscoveryItem");
export const discoveryPageBody = z
  .object({
    results: z.array(discoveryItemBody),
    nextPageToken: z.string().nullable(),
  })
  .openapi("DiscoveryPage");
const homeItemBody = discoveryItemBody.extend({
  reason: z.string(),
  artist: z.string().optional(),
});
export const discoveryHomeBody = z
  .object({
    sections: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["neighbours", "collaborations", "scene", "artists"]),
          title: z.string(),
          reason: z.string(),
          items: z.array(homeItemBody),
        })
        .openapi("DiscoverySection"),
    ),
    suggestions: z.array(homeItemBody),
    basedOn: z.array(z.string()),
    ideas: z.array(z.string()),
    scenes: z.array(z.string()).openapi({ description: "Genres précis les plus écoutés : les scènes à explorer" }),
    artists: z.array(z.string()).openapi({ description: "Artistes préférés puis les plus écoutés : points de départ" }),
    notice: z.string().nullable(),
    emptyReason: z.string().nullable(),
  })
  .openapi("DiscoveryHome");
export const discoverySavedBody = z
  .object({
    saved: z.literal(true),
    playlistId: z.string(),
    video: videoBody,
  })
  .openapi("DiscoverySaved");
