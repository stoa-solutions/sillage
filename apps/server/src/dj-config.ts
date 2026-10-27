import type { AiProvider } from "@playlist-recall/core/dj";

export interface DjConfig {
  provider?: AiProvider | "compatible";
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
export function djConfig(): DjConfig {
  const selected = process.env["DJ_PROVIDER"];
  const provider =
    selected === "google" || selected === "anthropic" ? selected : "compatible";
  const baseUrl =
    provider === "compatible"
      ? (process.env["DJ_BASE_URL"] ?? "https://api.openai.com/v1")
      : providerBaseUrl(provider);
  const model = process.env["DJ_MODEL"];
  const key = process.env["DJ_API_KEY"];
  return {
    provider,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    key,
    configured: Boolean(
      model && (key || (selected === "local" && process.env["DJ_BASE_URL"])),
    ),
  };
}
