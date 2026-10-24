export function djConfig() {
  const baseUrl = process.env.DJ_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.DJ_MODEL;
  const key = process.env.DJ_API_KEY;
  const local = process.env.DJ_PROVIDER === "local";
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    key,
    configured: Boolean(model && (key || (local && process.env.DJ_BASE_URL))),
  };
}

export type DjConfig = ReturnType<typeof djConfig>;
