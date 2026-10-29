import type { PinoLogger } from "hono-pino";

/** Request variables: the request's logger, then what authentication sets before feature routes. */
export type ApiEnvironment = {
  Variables: { installationId: string; userId: string; logger: PinoLogger };
};
