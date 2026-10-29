import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../../db/index.ts";
import type { ApiEnvironment } from "../../../shared/api-environment.ts";
import {
  commonErrors,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
} from "../../../shared/openapi.ts";
import { rpcRequestBody, rpcResponseBody } from "../types/mcp.schemas.ts";
import { handleMusicMcp } from "../services/mcp.service.ts";

const TAG = "Outils MCP";
const example = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Sillage Postman", version: "1.0.0" },
  },
};
const callRoute = createRoute({
  method: "post",
  path: "/mcp",
  ...operation({
    operationId: "callMusicMcp",
    tag: TAG,
    summary: "Appeler un outil musical MCP",
    description:
      "Transport Streamable HTTP stateless, authentifié avec le même Bearer que l’API. JSON-RPC 2.0 : initialisation, tools/list puis tools/call selon le client MCP. Catalogue limité au compte ; outils de recherche en lecture seule. Le DJ utilise en interne une connexion MCP en mémoire. MCP n’est pas un endpoint REST pour chaque outil.",
    effect: "provider",
    example,
  }),
  "x-sillage-accept": "application/json, text/event-stream",
  request: { body: jsonBody(rpcRequestBody, example) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(rpcResponseBody, "Réponse réussie"),
    202: { description: "Notification acceptée sans corps" },
  },
});
const unsupported = (method: "get" | "delete") =>
  createRoute({
    method,
    path: "/mcp",
    ...operation({
      operationId: `${method}MusicMcp`,
      tag: TAG,
      summary: "Méthode MCP non disponible en mode stateless",
      description:
        "Le transport monté reçoit cette méthode mais ne maintient aucune session ni flux SSE à reprendre. Utiliser POST avec un client MCP.",
    }),
    responses: {
      ...commonErrors(),
      405: jsonResponse(rpcResponseBody, "Méthode non prise en charge"),
    },
  });

/**
 * The music tools over MCP's stateless HTTP transport, under /v1. The transport answers with
 * its own responses, so the routes are documented here and served by a plain handler.
 */
export function mcpRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  for (const route of [callRoute, unsupported("get"), unsupported("delete")])
    app.openAPIRegistry.registerPath(route);
  app.all("/mcp", (c) => handleMusicMcp(db, c.req.raw, c.get("userId")));
  return app;
}
