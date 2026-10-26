import {
  generateText,
  jsonSchema,
  tool,
  Output,
  type AssistantModelMessage,
  type ModelMessage,
} from "ai";
import type { DjConfig } from "../../dj-config.ts";
import { aiModel, providerHttpStatus, thinkingOptions } from "./ai-model.ts";
import { DjUnavailable } from "./errors.ts";
import type { TraceObserver } from "./journal/contracts.ts";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
      // Keep the SDK's opaque reasoning/signature metadata across tool rounds.
      providerContent?: AssistantModelMessage["content"];
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

function modelMessages(messages: ChatMessage[]): ModelMessage[] {
  const names = new Map<string, string>();
  return messages.map((message): ModelMessage => {
    if (message.role === "tool") {
      const name = names.get(message.tool_call_id);
      if (!name)
        throw new DjUnavailable(
          "La réponse de l’outil du DJ est incomplète.",
          502,
        );
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.tool_call_id,
            toolName: name,
            output: { type: "json", value: JSON.parse(message.content) },
          },
        ],
      };
    }
    if (message.role !== "assistant") return message;
    for (const call of message.tool_calls ?? [])
      names.set(call.id, call.function.name);
    return {
      role: "assistant",
      content: message.providerContent ?? [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...(message.tool_calls ?? []).map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.function.name,
          input: JSON.parse(call.function.arguments),
        })),
      ],
    };
  });
}

/** One SDK step. The existing DJ loop owns MCP execution, grounding and limits. */
export async function completeTurn(
  config: DjConfig,
  messages: ChatMessage[],
  tools: ChatTool[],
  round: number,
  signal: AbortSignal,
  observe?: TraceObserver,
) {
  const started = Date.now();
  try {
    const result = await generateText({
      model: aiModel(config),
      instructions: messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n"),
      messages: modelMessages(
        messages.filter((message) => message.role !== "system"),
      ),
      ...(round < MAX_ROUNDS - 1
        ? {
            tools: Object.fromEntries(
              tools.map(({ function: definition }) => [
                definition.name,
                tool({
                  description: definition.description,
                  inputSchema: jsonSchema(definition.parameters),
                  // No execute: MCP and evidence validation remain in the DJ orchestration.
                }),
              ]),
            ),
            toolChoice: "auto" as const,
          }
        : {}),
      ...(config.provider !== "anthropic" ? { output: Output.json() } : {}),
      maxOutputTokens: config.model === "gemini-4-argon" ? 32768 : 4096,
      providerOptions: thinkingOptions(config),
      maxRetries: 0,
      abortSignal: signal,
    });
    const calls: ToolCall[] = result.toolCalls.map((call) => ({
      id: call.toolCallId,
      type: "function",
      function: { name: call.toolName, arguments: JSON.stringify(call.input) },
    }));
    const assistant = result.response.messages.findLast(
      (message) => message.role === "assistant",
    );
    const message = {
      content: result.text || null,
      ...(calls.length ? { tool_calls: calls } : {}),
      ...(assistant?.role === "assistant"
        ? { providerContent: assistant.content }
        : {}),
    };
    observe?.({
      kind: "provider",
      name: config.model,
      round,
      status: "ok",
      durationMs: Date.now() - started,
      output: {
        content: message.content,
        tool_calls: calls,
        usage: {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
        },
      },
    });
    return message;
  } catch (error) {
    const status = providerHttpStatus(error);
    observe?.({
      kind: "provider",
      name: config.model,
      round,
      status: "error",
      httpStatus: status,
      durationMs: Date.now() - started,
      output: { error: signal.aborted ? "canceled" : "provider_unavailable" },
    });
    if (signal.aborted) throw signal.reason;
    throw new DjUnavailable(
      status === 429
        ? "Le fournisseur a refusé la demande : limite de débit ou quota de ta clé atteint. Ce n’est pas le plafond Sillage. Ta lecture reste disponible ; vérifie le quota dans Réglages."
        : "La réponse du DJ est incomplète. Réessaie.",
      status === 429 ? 429 : 502,
    );
  }
}
