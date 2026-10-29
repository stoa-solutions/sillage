import { createRoute } from "@hono/zod-openapi";
import type { Database } from "../../../db/index.ts";
import type { ApiEnvironment } from "../../../shared/api-environment.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
  savedBody,
} from "../../../shared/openapi.ts";
import {
  agentBody,
  agentIdParam,
  agentInput,
  agentListBody,
} from "../types/dj-agents.schemas.ts";
import { djAgentsService, MAX_CUSTOM_AGENTS } from "../services/dj-agents.service.ts";

const TAG = "Agents du DJ";
const agentExample = {
  name: "Soirée calme",
  instructions:
    "Réponses courtes. Pour une suite, reste sur des morceaux doux et évite les ruptures d’énergie.",
};
const listRoute = createRoute({
  method: "get",
  path: "/",
  ...operation({
    operationId: "listDjAgents",
    tag: TAG,
    summary: "Agents disponibles",
    description:
      "Agents de base (id stable comme focus, lecture seule) puis agents personnalisés du compte. Un agent ajoute un profil aux règles du DJ : il ne change ni le format, ni les outils, ni la source. Envoyer son id dans agentId de /v1/dj/chat.",
  }),
  responses: {
    ...commonErrors(),
    200: jsonResponse(agentListBody, "Réponse réussie"),
  },
});
const createAgentRoute = createRoute({
  method: "post",
  path: "/",
  ...operation({
    operationId: "createDjAgent",
    tag: TAG,
    summary: "Créer un agent",
    description: `Crée un agent personnalisé pour le compte courant, ${MAX_CUSTOM_AGENTS} au maximum. Pour partir d’un agent de base, recopier ses instructions.`,
    effect: "write",
    example: agentExample,
  }),
  request: { body: jsonBody(agentInput, agentExample) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(agentBody, "Réponse réussie"),
    409: errorResponse("Nombre maximal d’agents atteint"),
  },
});
const updateRoute = createRoute({
  method: "put",
  path: "/{id}",
  ...operation({
    operationId: "updateDjAgent",
    tag: TAG,
    summary: "Modifier un agent",
    description:
      "Remplace le nom et les instructions d’un agent personnalisé du compte. Les agents de base ne sont pas modifiables.",
    effect: "write",
    example: agentExample,
  }),
  request: { params: agentIdParam, body: jsonBody(agentInput, agentExample) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(agentBody, "Réponse réussie"),
    404: errorResponse("Agent introuvable pour ce compte"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  ...operation({
    operationId: "deleteDjAgent",
    tag: TAG,
    summary: "Supprimer un agent",
    description:
      "Supprime un agent personnalisé du compte. Une demande au DJ qui l’utilise encore repasse sur l’agent par défaut.",
    effect: "write",
  }),
  request: { params: agentIdParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(savedBody, "Réponse réussie"),
    404: errorResponse("Agent introuvable pour ce compte"),
  },
});

const notFound = "Agent introuvable.";

/** The account's DJ agents, mounted under /v1/dj/agents. */
export function djAgentRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  const agents = djAgentsService(db);
  app.openapi(listRoute, async (c) =>
    c.json(await agents.list(c.get("userId")), 200),
  );
  app.openapi(createAgentRoute, async (c) => {
    const created = await agents.create(c.get("userId"), c.req.valid("json"));
    return created === "limit"
      ? c.json(
          {
            error: `Tu as déjà ${MAX_CUSTOM_AGENTS} agents. Supprimes-en un pour en créer un autre.`,
          },
          409,
        )
      : c.json(created, 200);
  });
  app.openapi(updateRoute, async (c) => {
    const updated = await agents.update(
      c.get("userId"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return updated ? c.json(updated, 200) : c.json({ error: notFound }, 404);
  });
  app.openapi(deleteRoute, async (c) =>
    (await agents.remove(c.get("userId"), c.req.valid("param").id))
      ? c.json({ saved: true as const }, 200)
      : c.json({ error: notFound }, 404),
  );
  return app;
}
