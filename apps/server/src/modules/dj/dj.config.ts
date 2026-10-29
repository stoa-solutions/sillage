import type { AiProvider } from "@sillage/core/dj";

/** The AI an account's DJ talks to: its provider, model and personal key. */
export interface DjConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string | undefined;
  key: string | undefined;
  configured: boolean;
}
export function providerBaseUrl(provider: AiProvider): string {
  return (
    provider === "google"
      ? (process.env["AI_GOOGLE_BASE_URL"] ??
        "https://generativelanguage.googleapis.com/v1beta")
      : (process.env["AI_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com/v1")
  ).replace(/\/$/, "");
}
