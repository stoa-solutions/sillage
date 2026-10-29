import { createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  commonErrors,
  featureRouter,
  jsonResponse,
  operation,
} from "../../../shared/openapi.ts";

const healthBody = z
  .object({ ok: z.boolean(), version: z.string(), release: z.string() })
  .openapi("Health");
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  ...operation({
    operationId: "getHealth",
    tag: "Système",
    summary: "État du serveur",
    description:
      "Vérifie PostgreSQL et retourne la version ainsi que le SHA déployé. Ne valide pas à lui seul la progression du worker.",
    public: true,
  }),
  responses: {
    ...commonErrors(true),
    200: jsonResponse(healthBody, "Réponse réussie"),
    503: jsonResponse(z.object({ ok: z.literal(false) }), "Base indisponible"),
  },
});

/** Liveness with the database and the deployed release (RELEASE_SHA). */
export function systemRoutes(db: Database) {
  const app = featureRouter();
  app.openapi(healthRoute, async (c) => {
    try {
      await db.orm.execute(sql`SELECT 1`);
      return c.json(
        {
          ok: true,
          version: "2.2.0",
          release: process.env["RELEASE_SHA"] ?? "local",
        },
        200,
      );
    } catch {
      return c.json({ ok: false as const }, 503);
    }
  });
  return app;
}
