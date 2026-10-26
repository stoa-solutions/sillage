import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText } from "ai";
import type { DjConfig } from "../../dj-config.ts";

/** Provider adapters own the wire format; the DJ owns tool execution and retries. */
export function aiModel(config: DjConfig) {
  const settings = { apiKey: config.key ?? "", baseURL: config.baseUrl };
  const model = config.model ?? "";
  switch (config.provider) {
    case "google":
      return createGoogleGenerativeAI(settings)(model);
    case "anthropic":
      return createAnthropic(settings)(model);
    default:
      return createOpenAICompatible({
        ...settings,
        name: "compatible",
      }).chatModel(model);
  }
}

export function thinkingOptions(
  config: DjConfig,
): Parameters<typeof generateText>[0]["providerOptions"] {
  if (!["gemini-4-argon", "gemini-3.8-flash"].includes(config.model ?? ""))
    return undefined;
  return config.provider === "google"
    ? { google: { thinkingConfig: { thinkingLevel: "low" } } }
    : { compatible: { reasoningEffort: "low" } };
}

export function providerHttpStatus(error: unknown): number | undefined {
  return APICallError.isInstance(error) ? error.statusCode : undefined;
}

export async function checkModel(config: DjConfig) {
  const result = await generateText({
    model: aiModel(config),
    prompt: "Réponds uniquement OK.",
    maxOutputTokens: 256,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30000),
    providerOptions: thinkingOptions(config),
  });
  return Boolean(result.text.trim());
}
