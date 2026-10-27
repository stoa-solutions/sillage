import { z } from "@hono/zod-openapi";
import { videoBody } from "../library/index.ts";

/** HTTP search input shared by validation and the generated developer contract. */
export const librarySearchInput = z
  .object({
    query: z.string().max(1000).default(""),
    playlistId: z.string().max(160).optional(),
    excludeIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{11}$/))
      .max(100)
      .optional(),
    availableOnly: z.boolean().optional(),
    minDuration: z.number().min(0).optional(),
    maxDuration: z.number().min(0).optional(),
    channel: z.string().max(300).optional(),
    publishedAfter: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    mode: z.enum(["text", "image"]).default("text"),
    sort: z.enum(["relevance", "position", "duration"]).default("relevance"),
    offset: z.number().int().min(0).max(50000).default(0),
    limit: z.number().int().min(1).max(100).default(48),
  })
  .openapi("LibrarySearch");

export const membershipBody = z
  .object({
    key: z.string(),
    playlistId: z.string(),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    position: z.number().int(),
  })
  .openapi("Membership");
export const searchResultBody = z
  .object({
    video: videoBody,
    score: z.number(),
    semantic: z.boolean(),
    memberships: z.array(membershipBody),
    reason: z.string(),
  })
  .openapi("SearchResult");
export const searchPageBody = z
  .object({
    results: z.array(searchResultBody),
    total: z.number().int(),
    degraded: z.string().nullable(),
    mode: z.enum(["text", "image"]),
  })
  .openapi("SearchPage");
