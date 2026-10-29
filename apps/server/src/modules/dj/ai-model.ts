import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, generateText } from "ai";
import type { DjConfig } from "./dj.config.ts";

/** Provider adapters own the wire format; the DJ owns tool execution and retries. */
export function aiModel(config: DjConfig) {
  const settings = { apiKey: config.key ?? "", baseURL: config.baseUrl };
  const model = config.model ?? "";
  return config.provider === "google"
    ? createGoogleGenerativeAI(settings)(model)
    : createAnthropic(settings)(model);
}

export function thinkingOptions(
  config: DjConfig,
): Parameters<typeof generateText>[0]["providerOptions"] {
  if (
    config.provider !== "google" ||
    !["gemini-4-argon", "gemini-3.8-flash"].includes(config.model ?? "")
  )
    return undefined;
  return { google: { thinkingConfig: { thinkingLevel: "low" } } };
}

export function providerHttpStatus(error: unknown): number | undefined {
  return APICallError.isInstance(error) ? error.statusCode : undefined;
}

export async function checkModel(config: DjConfig) {
  const providerOptions = thinkingOptions(config);
  const result = await generateText({
    model: aiModel(config),
    prompt: "Réponds uniquement OK.",
    maxOutputTokens: 256,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30000),
    ...(providerOptions ? { providerOptions } : {}),
  });
  return Boolean(result.text.trim());
}
