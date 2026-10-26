import { z } from "zod";
import type { DjConfig } from "../../dj-config.ts";
import { DjUnavailable } from "./errors.ts";

const toolCall = z.looseObject({
  id: z.string(),
  type: z.literal("function"),
  function: z.looseObject({ name: z.string(), arguments: z.string() }),
});
const assistantMessage = z.object({
  content: z.string().nullish(),
  tool_calls: z.array(toolCall).nullish(),
  // Gemini can attach opaque thought signatures that must survive the next round.
  extra_content: z.unknown().optional(),
});
type ToolCall = z.infer<typeof toolCall>;
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
      extra_content?: unknown;
    }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export const MAX_ROUNDS = 5;

/** Provider-specific wire format only. Selection and playback policy live elsewhere. */
export async function completeTurn(
  config: DjConfig,
  messages: ChatMessage[],
  tools: ChatTool[],
  round: number,
  signal: AbortSignal,
) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      // No tools on the last round: conclude from evidence already collected.
      ...(round < MAX_ROUNDS - 1
        ? { tools, tool_choice: "auto" }
        : {}),
      max_completion_tokens: config.model === "gemini-4-argon" ? 32768 : 4096,
      ...(["gemini-4-argon", "gemini-3.8-flash"].includes(config.model ?? "")
        ? { reasoning_effort: "low" }
        : {}),
      // AUTO permits both tool calls and ordinary structured replies. Requiring
      // a tool here turns acknowledgements into unnecessary catalog searches.
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    throw new DjUnavailable(
      response.status === 429
        ? "Google a refusé la demande : limite de débit ou quota de ta clé Gemini atteint. Ce n’est pas le plafond Recall. Ta lecture reste disponible ; vérifie le quota de ta clé dans Réglages avant de réessayer."
        : "L’IA du DJ ne répond pas pour le moment. Réessaie dans un instant.",
      response.status === 429 ? 429 : 502,
    );
  }
  const envelope = z.object({
    choices: z.array(z.object({ message: assistantMessage })).min(1),
  });
  const parsed = envelope.safeParse(await response.json());
  if (!parsed.success) {
    throw new DjUnavailable("La réponse du DJ est incomplète. Réessaie.", 502);
  }
  return parsed.data.choices[0].message;
}
