import { z } from "@hono/zod-openapi";

export const lyricsVideoParam = z.object({
  videoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .openapi({
      param: { name: "videoId", in: "path" },
      description: "Vidéo appartenant à la bibliothèque du compte",
    }),
});
export const lyricsOffsetInput = z.object({
  offsetMs: z.number().int().min(-30000).max(30000),
});
export const lyricsBody = z
  .object({
    status: z.enum(["synced", "plain", "instrumental", "missing", "unavailable"]),
    lines: z.array(
      z.object({
        startMs: z.number().int(),
        endMs: z.number().int(),
        text: z.string(),
      }),
    ),
    text: z.string().nullable(),
    offsetMs: z.number().int(),
    durationDeltaMs: z.number().int().nullable(),
    source: z
      .object({ name: z.literal("LRCLIB"), id: z.number().int() })
      .nullable(),
  })
  .openapi("Lyrics");
