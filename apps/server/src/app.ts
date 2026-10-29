import { enrichmentRoutes } from "./modules/enrichment/index.ts";
import { discoveryRoutes } from "./modules/discovery/index.ts";
import { historyRoutes } from "./modules/history/index.ts";
import {
  authRoutes,
  sessionGuard,
  type IdentityProvider,
} from "./modules/auth/index.ts";
import { accountRoutes } from "./modules/accounts/index.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { releaseRoutes } from "./modules/releases/index.ts";
import { playerRoutes } from "./modules/player/index.ts";
import { systemRoutes } from "./modules/system/index.ts";
import type { ApiEnvironment } from "./shared/api-environment.ts";
import { createDjRoutes } from "./modules/dj/index.ts";
import { djAgentRoutes } from "./modules/dj-agents/index.ts";
import { tasteRoutes } from "./modules/taste/index.ts";
import { cors } from "hono/cors";
import { pinoLogger } from "hono-pino";
import { errorFields, logger } from "./shared/logger.ts";
import { InvalidInput } from "./shared/errors.ts";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Database } from "./db/index.ts";
import { libraryRoutes } from "./modules/library/index.ts";
import { searchRoutes } from "./modules/search/index.ts";
import { defaultLyricsSources, lyricsRoutes, type LyricsSources } from "./modules/lyrics/index.ts";
import type { LyricsSource } from "./integrations/lrclib/index.ts";
import { mcpRoutes } from "./modules/mcp/index.ts";
import { defaultInsightsSources, insightsRoutes, type InsightsSources } from "./modules/insights/index.ts";
/** The services the API reaches over the network. Production leaves them out; tests fake them. */
export interface AppOptions {
  /** Google sign-in. */
  identity?: IdentityProvider;
  /** LRCLIB alone, or every lyrics source. */
  lyrics?: LyricsSource | LyricsSources;
  /** Any of the artist and album sources. */
  insights?: Partial<InsightsSources>;
}

export function createApp(db: Database, options: AppOptions = {}) {
  // OpenAPIHono collects the documented routes of the features mounted below.
  const app = new OpenAPIHono<ApiEnvironment>();
  // One line per request: method, path without its query, status, account. Never headers.
  app.use(
    "*",
    pinoLogger({
      pino: logger,
      http: {
        onReqMessage: false,
        onReqBindings: (c) => ({ req: { method: c.req.method, path: c.req.path } }),
        onResBindings: (c) => ({
          res: { status: c.res.status },
          ...(c.get("userId") ? { userId: c.get("userId") } : {}),
        }),
        onResLevel: (c) =>
          c.res.status >= 500 ? "error" : c.req.path === "/health" ? "debug" : "info",
      },
    }),
  );
  app.use(
    "*",
    cors({
      origin: (origin) =>
        (process.env["ALLOWED_ORIGINS"] ?? "https://sillage.stoa.solutions")
          .split(",")
          .includes(origin)
          ? origin
          : null,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 3600,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) => c.json({ error: "Fichier trop volumineux." }, 413),
    }),
  );
  app.route("/auth", authRoutes(db, options.identity));
  app.route("/", systemRoutes(db));
  app.route("/", playerRoutes());
  app.route("/macos", releaseRoutes());
  app.use("/v1/*", sessionGuard(db));
  app.route("/v1", accountRoutes(db));
  app.route("/v1/discover", discoveryRoutes(db));
  app.route("/v1/dj/agents", djAgentRoutes(db));
  app.route("/v1/dj", createDjRoutes(db));
  app.route("/v1/history", historyRoutes(db));
  app.route("/v1/taste", tasteRoutes(db));
  app.route("/v1", mcpRoutes(db));
  app.route("/v1", enrichmentRoutes(db));
  app.route("/v1", libraryRoutes(db));
  app.route("/v1", searchRoutes(db));
  app.route("/v1/lyrics", lyricsRoutes(db, defaultLyricsSources(db, options.lyrics)));
  app.route("/v1/insights", insightsRoutes(db, defaultInsightsSources(db, options.insights)));
  app.onError((error, c) => {
    // Malformed JSON or a body without its JSON content type, rejected by the route validator.
    if (
      error instanceof z.ZodError ||
      (error instanceof HTTPException && [400, 415].includes(error.status))
    )
      return c.json({ error: "Données invalides." }, 400);
    if (error instanceof InvalidInput)
      return c.json({ error: error.message }, 400);
    c.var.logger.error(errorFields(error), "API request failed");
    return c.json(
      { error: "Le serveur ne peut pas traiter cette demande." },
      500,
    );
  });
  return app;
}
