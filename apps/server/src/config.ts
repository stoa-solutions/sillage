import { z } from "zod";

/**
 * The environment each process needs, checked once at start-up so a typo fails the deployment
 * instead of a request hours later. Modules still read process.env when they need a value:
 * tests change it per case. Error messages name variables, never their values.
 */
const flag = z.enum(["true", "false"]);
const url = z.url();
const urls = z
  .string()
  .refine((value) => value.split(",").every((item) => URL.canParse(item.trim())));
const uuids = z
  .string()
  .refine((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .every((item) => z.uuid().safeParse(item).success),
  );
const positive = z.coerce.number().int().positive();

const shared = z.object({
  DATABASE_URL: url,
  RELEASE_SHA: z.string().optional(),
  INFERENCE_URL: url.optional(),
  VISION_ENABLED: flag.optional(),
});

const api = shared.extend({
  PORT: positive.optional(),
  PUBLIC_URL: url.optional(),
  ALLOWED_ORIGINS: urls.optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DJ_SETTINGS_ENCRYPTION_KEY: z
    .string()
    .regex(/^([a-f0-9]{64})?$/i, "64 caractères hexadécimaux")
    .optional(),
  DJ_PROVIDER: z.string().optional(),
  DJ_BASE_URL: url.optional(),
  DJ_DAILY_REQUEST_LIMIT: positive.optional(),
  DJ_ACCOUNT_DAILY_LIMITS: z
    .string()
    .refine((value) => {
      try {
        JSON.parse(value || "{}");
        return true;
      } catch {
        return false;
      }
    }, "JSON valide")
    .optional(),
  DJ_CONCURRENT_TURNS: positive.optional(),
  AI_GOOGLE_BASE_URL: url.optional(),
  AI_ANTHROPIC_BASE_URL: url.optional(),
  SEARXNG_URL: z.union([z.literal(""), url]).optional(),
  YOUTUBE_DAILY_BUDGET: positive.optional(),
  MUSICBRAINZ_ACCOUNT_IDS: uuids.optional(),
});

const worker = shared.extend({
  SYNC_ENABLED: flag.optional(),
  YOUTUBE_DAILY_BUDGET: positive.optional(),
  MUSICBRAINZ_ACCOUNT_IDS: uuids.optional(),
});

const inference = z.object({
  PORT: positive.optional(),
  MODEL_PATH: z.string().optional(),
  MODEL_THREADS: positive.optional(),
  VISION_ENABLED: flag.optional(),
});

const schemas = { api, worker, inference, migrate: shared.pick({ DATABASE_URL: true }) };

/** Throws with every invalid variable name when the process cannot start correctly. */
export function checkEnvironment(
  process: keyof typeof schemas,
  env: NodeJS.ProcessEnv = globalThis.process.env,
) {
  // Empty values mean "not set", as docker-compose passes `${VAR:-}`.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schemas[process].safeParse(present);
  const problems = result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join(".")} (${issue.message})`,
      );
  if (process === "api" && Boolean(env["GOOGLE_CLIENT_ID"]) !== Boolean(env["GOOGLE_CLIENT_SECRET"]))
    problems.push("GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET vont ensemble");
  if (problems.length)
    throw new Error(`Configuration invalide : ${problems.join(", ")}`);
}
