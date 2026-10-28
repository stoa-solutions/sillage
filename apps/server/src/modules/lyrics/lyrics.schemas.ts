import { z } from "@hono/zod-openapi";

export const lyricsVideoParam = z.object({
  videoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .openapi({
      param: { name: "videoId", in: "path" },
      description: "Vidéo YouTube, dans la bibliothèque ou non",
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
      .object({
        name: z.string().openapi({ description: "LRCLIB, « YouTube Music · fournisseur » ou lyrics.ovh" }),
        id: z.number().int().nullable().openapi({ description: "Identifiant LRCLIB ; null pour les autres sources" }),
      })
      .nullable(),
  })
  .openapi("Lyrics");
