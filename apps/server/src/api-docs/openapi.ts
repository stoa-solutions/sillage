import { createApp } from "../app.ts";
import type { Database } from "../db/index.ts";

export type Method = "get" | "post" | "delete";
type Effect = "read" | "write" | "provider" | "browser";
/** An operation of the generated document, with Sillage's x- extensions. */
export interface Operation {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security?: Record<string, string[]>[];
  parameters?: Record<string, unknown>[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, Record<string, unknown>>;
  "x-sillage-effect": Effect;
  "x-sillage-example"?: unknown;
  "x-sillage-accept"?: string;
}

/**
 * Every operation is declared next to its route (createRoute) and collected by the app:
 * this document only adds the description, servers, tags and security schemes. Building the
 * app here never touches the database.
 */
const generated = createApp({} as Database).getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Sillage", version: "2.2.0" },
}) as unknown as {
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Sillage — API développeur privée",
    version: "2.2.0",
    description:
      "Contrat généré depuis les validateurs et les routes de Sillage. Documentation locale, non publiée sur le serveur de production. Connexion : navigateur Google + PKCE → code Sillage à usage unique → jeton Bearer propre au compte. Les playlists et clés Gemini sont isolées par compte. /v1/* : 180 requêtes/minute/jeton ; une opération DJ simultanée par compte, deux sur cette instance. Les erreurs métier peuvent aussi être retournées en HTTP 200 : lire les états. Le lecteur, le micro et la file native ne sont pas des APIs HTTP de contrôle à distance.",
  },
  servers: [
    {
      url: "http://127.0.0.1:3001",
      description: "API locale de développement",
    },
    {
      url: "https://recall.stoa.solutions",
      description: "Serveur privé Sillage — opérations authentifiées",
    },
  ],
  tags: [
    "Système",
    "Connexion Google",
    "Compte",
    "Bibliothèque",
    "Recherche",
    "Découvrir",
    "DJ",
    "Historique",
    "Journal DJ",
    "Paroles",
    "Outils MCP",
    "Maintenance",
    "Lecteur et distribution",
  ].map((name) => ({ name, description: `Routes ${name} de Sillage` })),
  security: [{ sessionBearer: [] as string[] }],
  paths: generated.paths,
  components: {
    securitySchemes: {
      sessionBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "Jeton de session Sillage obtenu après la connexion Google ; ce n’est pas la clé Gemini. Ne jamais le placer dans une URL.",
      },
      googleFlowCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-recall-auth",
        description:
          "Cookie du flux navigateur, valable 10 minutes, à usage unique avec state.",
      },
    },
    schemas: generated.components.schemas,
  },
};
