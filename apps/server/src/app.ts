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
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Database } from "./db/index.ts";
import { jobRoutes } from "./modules/jobs/index.ts";
import { libraryRoutes } from "./modules/library/index.ts";
import { searchRoutes } from "./modules/search/index.ts";
import { lyricsRoutes } from "./modules/lyrics/index.ts";
import { Lrclib, type LyricsSource } from "./integrations/lrclib/index.ts";
import { mcpRoutes } from "./modules/mcp/index.ts";
export function createApp(
  db: Database,
  identityProvider?: IdentityProvider,
  lyricsSource: LyricsSource = new Lrclib(),
) {
  // OpenAPIHono collects the documented routes of the features mounted below.
  const app = new OpenAPIHono<ApiEnvironment>();
  app.use(
    "*",
    cors({
      origin: (origin) =>
        (process.env["ALLOWED_ORIGINS"] ?? "https://recall.stoa.solutions")
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
  app.route("/auth", authRoutes(db, identityProvider));
  app.route("/", systemRoutes(db));
  app.route("/", playerRoutes());
  app.route("/macos", releaseRoutes());
  app.use("/v1/*", sessionGuard(db));
  app.route("/v1", accountRoutes(db));
  app.route("/v1/discover", discoveryRoutes(db));
  app.route("/v1/dj", createDjRoutes(db));
  app.route("/v1/history", historyRoutes(db));
  app.route("/v1", mcpRoutes(db));
  app.route("/v1", enrichmentRoutes(db));
  app.route("/v1", libraryRoutes(db));
  app.route("/v1", jobRoutes(db));
  app.route("/v1", searchRoutes(db));
  app.route("/v1/lyrics", lyricsRoutes(db, lyricsSource));
  app.onError((error, c) => {
    // Malformed JSON or a body without its JSON content type, rejected by the route validator.
    if (
      error instanceof z.ZodError ||
      (error instanceof HTTPException && [400, 415].includes(error.status))
    )
      return c.json({ error: "Données invalides." }, 400);
    if (
      /Identifiant|Utilisez un lien|fichier|playlist JSON|entrée|durée|Durée|Position|sauvegarde|import/i.test(
        error.message,
      )
    )
      return c.json({ error: error.message }, 400);
    console.error("API request failed", error.name);
    return c.json(
      { error: "Le serveur ne peut pas traiter cette demande." },
      500,
    );
  });
  return app;
}
