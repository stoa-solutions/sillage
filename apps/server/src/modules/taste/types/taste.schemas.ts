import { z } from "@hono/zod-openapi";
import { TASTE_RULES } from "../taste.rules.ts";

export const videoIdParam = z.object({ videoId: z.string().regex(/^[\w-]{11}$/) });
/** none withdraws the opinion. */
export const feedbackInput = z
  .object({ value: z.enum(["like", "dislike", "none"]) })
  .openapi("TrackFeedbackInput");
export const feedbackBody = z
  .object({
    videoId: z.string(),
    value: z.enum(["like", "dislike"]).nullable(),
  })
  .openapi("TrackFeedback");
export const tasteSettingsInput = z
  .object({
    dislikeDays: z
      .number()
      .int()
      .min(TASTE_RULES.dislikeDays.min)
      .max(TASTE_RULES.dislikeDays.max),
  })
  .openapi("TasteSettingsInput");
export const tasteOverviewBody = z
  .object({
    dislikeDays: z.number().int(),
    summary: z.object({
      tracks: z.number().int(),
      listens: z.number().int(),
      liked: z.number().int(),
      hidden: z.number().int(),
    }),
    artists: z.array(
      z.object({
        name: z.string(),
        tracks: z.number().int(),
        listens: z.number().int(),
        score: z.number(),
        affinity: z.number().int(),
      }),
    ),
    tracks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        channel: z.string().nullable(),
        durationSeconds: z.number().nullable(),
        artist: z.string().optional(),
        category: z.enum(["favourite", "frequent", "heard", "unconvinced", "hidden", "unknown"]),
        categoryTitle: z.string(),
        affinity: z.number().int(),
        listens: z.number().int(),
        opinion: z.enum(["like", "dislike"]).nullable(),
        daysLeft: z.number().int().optional(),
        label: z.string().optional(),
      }),
    ),
  })
  .openapi("TasteOverview");
export const tasteSettingsBody = z
  .object({ dislikeDays: z.number().int() })
  .openapi("TasteSettings");
