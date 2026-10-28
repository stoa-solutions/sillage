import { z } from "@hono/zod-openapi";
import { TASTE_RULES } from "./taste.rules.ts";

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
export const tasteSettingsBody = z
  .object({ dislikeDays: z.number().int() })
  .openapi("TasteSettings");
