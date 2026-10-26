import { z } from "zod";

/** Validated HTTP input and structured provider output. No effects in this module. */
export const djInput = z.object({
  conversationId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  trigger: z.enum(["user", "continuation"]).optional(),
  scope: z.enum(["library", "youtube", "all"]).optional(),
  playbackContext: z
    .object({
      current: z
        .object({
          id: z.string().regex(/^[\w-]{11}$/),
          title: z.string().max(300),
          channel: z.string().max(200),
          artists: z.array(z.string().max(100)).max(8),
          genres: z.array(z.string().max(80)).max(8),
        })
        .nullish(),
      direction: z.string().max(600),
    })
    .optional(),
  message: z.string().trim().min(1).max(1500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(12)
    .default([]),
  discoveryContext: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{11}$/),
        title: z.string().max(300),
        channel: z.string().max(200).nullish(),
      }),
    )
    .max(8)
    .default([]),
  rejectedIds: z
    .array(z.string().regex(/^[\w-]{11}$/))
    .max(100)
    .default([]),
  excludeIds: z
    .array(z.string().regex(/^[\w-]{11}$/))
    .max(100)
    .default([]),
});
export const selection = z.object({
  // Conversation is an explicit no-operation, not a failed musical selection.
  kind: z.enum(["music", "information", "conversation"]).default("music"),
  discoveryIds: z
    .array(z.string().regex(/^[\w-]{11}$/))
    .max(8)
    .optional(),
  citationIds: z.array(z.number().int().min(1).max(40)).max(5).optional(),
  reply: z.string().min(1).max(1500),
  trackIds: z.array(z.string().regex(/^[\w-]{11}$/)).max(8),
  action: z.enum(["replace", "append", "keep"]),
});

export type DjInput = z.infer<typeof djInput>;
export type Selection = z.infer<typeof selection>;
