import { z } from "@hono/zod-openapi";
import { AI_PROVIDER_IDS } from "@sillage/core/dj";
import { discoveryItemBody } from "../discovery/index.ts";
import { trackBody } from "../library/index.ts";
import { djInput } from "./dj.contracts.ts";
import { djSettingsInput } from "./dj-settings.service.ts";

export const djRequestBody = djInput.openapi("DjRequest");
export const djSettingsBody = djSettingsInput.openapi("DjSettings");
export const djResetBody = z
  .object({ provider: z.enum(AI_PROVIDER_IDS).optional() })
  .openapi("DjReset");
export const djCheckBody = djSettingsInput
  .safeExtend({ voice: z.boolean().default(false) })
  .openapi("DjCheck");
export const speechRequestBody = z
  .object({ text: z.string().trim().min(1).max(600) })
  .openapi("SpeechRequest", {
    description: "Le texte est nettoyé des espaces aux extrémités.",
  });

const provider = z.enum(["google", "anthropic"]);
export const djStatusBody = z
  .object({
    provider,
    providers: z.array(
      z.object({
        id: provider,
        name: z.string(),
        configured: z.boolean(),
        model: z.string(),
        defaultModel: z.string(),
        keyUrl: z.string(),
        models: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),
    configured: z.boolean(),
    voice: z.boolean(),
    model: z.string().nullable(),
    personal: z.boolean(),
    settingsAvailable: z.boolean(),
  })
  .openapi("DjStatus");
export const checkResultBody = z
  .object({ ok: z.boolean(), voice: z.boolean(), message: z.string() })
  .openapi("CheckResult");
export const speechResultBody = z
  .object({
    audio: z.string().openapi({
      description: "Fichier WAV encodé en base64.",
    }),
    mimeType: z.literal("audio/wav"),
  })
  .openapi("SpeechResult");
export const informationSourceBody = z
  .object({
    id: z.number().int(),
    title: z.string(),
    url: z.string(),
    snippet: z.string().optional(),
  })
  .openapi("InformationSource");
export const djResponseBody = z
  .object({
    reply: z.string(),
    action: z.enum(["replace", "append", "keep"]),
    tracks: z.array(trackBody),
    discoveries: z.array(discoveryItemBody).optional(),
    sources: z.array(informationSourceBody).optional(),
    source: z.string().optional(),
    /** The agent that answered, when it is not the default DJ. */
    agent: z.object({ id: z.string(), name: z.string() }).optional(),
  })
  .openapi("DjResponse");
export const rulesBody = z.object({ prompt: z.string() });
export const rulesQuery = z.object({
  agentId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/i)
    .optional(),
});
