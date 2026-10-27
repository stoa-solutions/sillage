import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "hono";

/**
 * Feature routers that document themselves: each route is declared with its Zod request and
 * response schemas, Hono validates the request, and the OpenAPI document is generated from the
 * same declarations (see api-docs/openapi.ts).
 */
export function featureRouter<E extends Env = Env>(
  invalid = "Données invalides.",
) {
  return new OpenAPIHono<E>({
    // Same answer as any other invalid input of the feature, whatever the validator.
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: invalid }, 400);
      return undefined;
    },
  });
}

export const errorBody = z
  .object({
    error: z.string(),
    source: z.string().optional(),
    reason: z.string().optional(),
    retryAt: z.iso.datetime().optional(),
  })
  .openapi("Error");
export const savedBody = z.object({ saved: z.literal(true) }).openapi("Saved");

/** What a call does, for API explorers: a write or a provider call is never run by surprise. */
export type Effect = "read" | "write" | "provider" | "browser";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
export const errorResponse = (description: string) =>
  json(errorBody, description);
export const textResponse = (mime: string, description: string) => ({
  description,
  content: { [mime]: { schema: z.string() } },
});

/** Errors any route may answer; session ones only behind the /v1 bearer guard. */
function commonErrors(isPublic = false) {
  return {
    400: errorResponse("Données invalides"),
    413: errorResponse("Corps supérieur à 30 Mio"),
    500: errorResponse("Erreur interne sans diagnostic privé"),
    ...(isPublic
      ? {}
      : {
          401: errorResponse("Session absente, expirée ou révoquée"),
          429: errorResponse("Limite de débit ou opération déjà en cours"),
        }),
  };
}

export interface Operation {
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  effect?: Effect;
  /** Reachable without the bearer token. */
  public?: boolean;
  /** Example body for Postman; never a real secret. */
  example?: unknown;
}

/** The descriptive part of a route, spread into createRoute next to its schemas. */
export function operation({
  tag,
  effect = "read",
  public: isPublic = false,
  example,
  ...rest
}: Operation) {
  return {
    ...rest,
    tags: [tag],
    "x-sillage-effect": effect,
    ...(isPublic ? { security: [] } : {}),
    ...(example === undefined ? {} : { "x-sillage-example": example }),
  };
}

/** A JSON request body with its Postman example. */
export const jsonBody = <T extends z.ZodType>(schema: T, example?: unknown) => ({
  required: true,
  content: {
    "application/json": {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});

export const jsonResponse = json;
export { commonErrors };
