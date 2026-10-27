import { z } from "zod";

/** Validated HTTP input and structured provider output. No effects in this module. */
export const djInput = z.object({
  conversationId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  trigger: z.enum(["user", "continuation"]).optional(),
  scope: z.enum(["library", "youtube", "all"]).optional(),
  /** A base agent key (`focus`) or a custom agent uuid; unknown ones fall back to the default. */
  agentId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/i)
    .optional(),
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
  /**
   * A structured refill: the client asks for N fresh tracks after the current one.
   * Its planning never depends on the wording of `message`, which older clients still send.
   */
  continuation: z
    .object({
      count: z.number().int().min(1).max(8).default(5),
      broaden: z.boolean().default(false),
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
const videoIds = z.array(z.string().regex(/^[\w-]{11}$/)).max(8);
/** Providers write `null` for an unused field; that is an absence, not an unreadable answer. */
const absent = <T extends z.ZodType>(schema: T, fallback: z.infer<T>) =>
  schema.nullish().transform((value) => value ?? fallback);

export const selection = z.object({
  // Conversation is an explicit no-operation, not a failed musical selection.
  kind: absent(z.enum(["music", "information", "conversation"]), "music"),
  discoveryIds: absent(videoIds, []),
  citationIds: absent(z.array(z.number().int().min(1).max(40)).max(5), []),
  reply: z.string().trim().min(1).max(1500),
  explanation: z
    .string()
    .trim()
    .max(600)
    .nullish()
    .transform((value) => value || undefined),
  trackIds: absent(videoIds, []),
  action: absent(z.enum(["replace", "append", "keep"]), "keep"),
});

export type DjInput = z.infer<typeof djInput>;
export type Selection = z.infer<typeof selection>;
