import pino from "pino";

/**
 * One structured JSON logger per process (API, worker, inference). LOG_LEVEL sets the threshold;
 * tests are silent unless they ask. Secrets are redacted even if a caller logs them by mistake.
 */
export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? (process.env["VITEST"] ? "silent" : "info"),
  redact: {
    paths: ["*.authorization", "*.Authorization", "*.apiKey", "*.key", "*.token", "*.cookie"],
    censor: "[secret]",
  },
});

/** What an unexpected error says in the logs: never its payload, which may hold user data. */
export function errorFields(error: unknown) {
  return error instanceof Error
    ? { error: { name: error.name, message: error.message, stack: error.stack } }
    : { error: { message: String(error) } };
}
