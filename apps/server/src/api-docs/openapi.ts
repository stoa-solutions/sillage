import { createApp } from "../app.ts";
import type { Database } from "../db/index.ts";
import {
  schemas,
  ref,
  object,
  string,
  integer,
  boolean,
  array,
  type Schema,
} from "./schemas.ts";

export type Method = "get" | "post" | "delete";
type Effect = "read" | "write" | "provider" | "browser";
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

const json = (schema: Schema | string, description = "Réponse réussie") => ({
  description,
  content: {
    "application/json": {
      schema: typeof schema === "string" ? ref(schema) : schema,
    },
  },
});
const text = (mime: string, description: string) => ({
  description,
  content: { [mime]: { schema: { type: "string" } } },
});
const error = (description: string) => json("Error", description);
const parameter = (
  name: string,
  location: "path" | "query",
  schema: Schema,
  required = location === "path",
  description?: string,
) => ({
  name,
  in: location,
  required,
  schema,
  ...(description ? { description } : {}),
});
const id = (name: string, description: string, pattern?: string) =>
  parameter(
    name,
    "path",
    { type: "string", ...(pattern ? { pattern } : {}) },
    true,
    description,
  );
const query = (name: string) => {
  const schema = schemas[name];
  if (!schema) throw new Error(`Unknown query schema ${name}.`);
  return Object.entries(schema["properties"] as Record<string, Schema>).map(
    ([key, value]) =>
      parameter(
        key,
        "query",
        value,
        (schema["required"] as string[] | undefined)?.includes(key) ?? false,
      ),
  );
};
const unavailable = {
  "502": error("Fournisseur temporairement indisponible"),
  "503": error("Configuration ou service indisponible"),
};
const paths: Record<string, Partial<Record<Method, Operation>>> = {};
const generated = createApp({
  query: async () => ({ rows: [], rowCount: 0 }),
} as unknown as Database).getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Sillage", version: "2.2.0" },
}) as unknown as {
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, Schema> };
};

function add(
  method: Method,
  path: string,
  operationId: string,
  tag: string,
  summary: string,
  description: string,
  result: Schema | string,
  options: Partial<Operation> & {
    status?: string;
    public?: boolean;
    input?: Schema | string;
    effect?: Effect;
    example?: unknown;
  } = {},
) {
  const {
    status = "200",
    public: isPublic = false,
    input,
    effect = "read",
    example,
    responses = {},
    ...rest
  } = options;
  const operation: Operation = {
    operationId,
    tags: [tag],
    summary,
    description,
    "x-sillage-effect": effect,
    ...(isPublic ? { security: [] } : {}),
    ...(input
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: typeof input === "string" ? ref(input) : input,
                ...(example !== undefined ? { example } : {}),
              },
            },
          },
        }
      : {}),
    ...(example !== undefined ? { "x-sillage-example": example } : {}),
    responses: {
      ...(status ? { [status]: json(result) } : {}),
      "400": error("Données invalides"),
      "413": error("Corps supérieur à 30 Mio"),
      "500": error("Erreur interne sans diagnostic privé"),
      ...(!isPublic
        ? {
            "401": error("Session absente, expirée ou révoquée"),
            "429": error("Limite de débit ou opération déjà en cours"),
          }
        : {}),
      ...responses,
    },
    ...rest,
  };
  paths[path] = { ...paths[path], [method]: operation };
}

add(
  "get",
  "/health",
  "getHealth",
  "Système",
  "État du serveur",
  "Vérifie PostgreSQL et retourne la version ainsi que le SHA déployé. Ne valide pas à lui seul la progression du worker.",
  "Health",
  {
    public: true,
    responses: {
      "503": json(object({ ok: { const: false } }), "Base indisponible"),
    },
  },
);
// Routes declared with createRoute document themselves: their operations come from the app.
Object.assign(paths, generated.paths);

add(
  "get",
  "/v1/dj/rules",
  "getDjRules",
  "DJ",
  "Prompt système actuel",
  "Règles de l’agent côté serveur, consultables par un compte connecté. Cette route ne modifie pas le prompt.",
  object({ prompt: string() }),
);
add(
  "get",
  "/v1/dj/status",
  "getDjStatus",
  "DJ",
  "État du modèle et de la voix",
  "Retourne le fournisseur actif, le catalogue et les capacités de chaque fournisseur, sans jamais renvoyer les clés. personal distingue les réglages du compte du mode historique.",
  "DjStatus",
);
add(
  "post",
  "/v1/dj/settings",
  "saveDjSettings",
  "DJ",
  "Enregistrer sa clé ou changer de modèle",
  "provider vaut google par défaut pour les clients existants. La première configuration de chaque fournisseur exige apiKey ; ensuite model seul conserve sa clé. Changer de fournisseur conserve les autres clés et modèles. Chiffrement AES-256-GCM côté serveur avec contexte du compte ; clé jamais renvoyée. L’enregistrement ne vérifie pas le fournisseur : utiliser /check pour tester, ce qui consomme le quota du fournisseur.",
  "Saved",
  {
    effect: "write",
    input: "DjSettings",
    example: { apiKey: "{{gemini_api_key}}", model: "gemini-3.5-flash-lite" },
    responses: { "503": error("Chiffrement des réglages non configuré") },
  },
);
add(
  "post",
  "/v1/dj/settings/reset",
  "resetDjSettings",
  "DJ",
  "Supprimer la clé enregistrée du compte",
  "Avec provider, supprime uniquement sa clé ; sans provider, supprime toutes les clés du compte courant. Aucun changement automatique de fournisseur après suppression. Le DJ d’un utilisateur Google sera à reconfigurer ; les playlists restent disponibles.",
  "Saved",
  { effect: "write", input: "DjReset", example: {provider:"google"} },
);
add(
  "post",
  "/v1/dj/check",
  "checkDjProvider",
  "DJ",
  "Tester clé, modèle et voix",
  "Appel réel au fournisseur sélectionné (google par défaut), sans enregistrer les paramètres fournis. Sans apiKey, teste uniquement sa clé existante. Avec Claude, voice reste false : la voix macOS est locale. ok=false ou voice=false peuvent être retournés avec HTTP 200 : lire le résultat métier. Une seule opération DJ par compte et deux au maximum sur cette instance.",
  "CheckResult",
  {
    effect: "provider",
    input: "DjCheck",
    example: { model: "gemini-3.5-flash-lite", voice: false },
  },
);
add(
  "post",
  "/v1/dj/chat",
  "askDj",
  "DJ",
  "Demander au DJ",
  "scope est la source explicite : library, youtube ou all. Le serveur exécute les outils puis retourne une opération validée ; le Mac joue ensuite les tracks. replace remplace maintenant, append ajoute sans interrompre, keep conserve la lecture. discoveries propose des cartes ; sources accompagne une recherche d’information. Envoyer playbackContext, historique et exclusions pour une suite cohérente. conversationId et requestId optionnels relient le chat aux actions du client ; trigger distingue demande et continuation. X-Sillage-Trace-Id identifie le tour, X-Sillage-Journal vaut saved ou unavailable sans changer la réponse JSON. Aucun ajout à la bibliothèque par cette route. Une opération DJ simultanée par compte ; 429 peut signifier occupé, pas forcément quota épuisé.",
  "DjResponse",
  {
    effect: "provider",
    input: "DjRequest",
    example: {
      message: "Propose du jazz sans lancer la lecture.",
      scope: "library",
      history: [],
      excludeIds: [],
      discoveryContext: [],
      rejectedIds: [],
    },
    responses: unavailable,
  },
);
add(
  "post",
  "/v1/dj/speech",
  "synthesizeDjSpeech",
  "DJ",
  "Préparer une annonce vocale",
  "Synthèse vocale Gemini avec la clé du compte ; renvoie un WAV encodé en base64, pas un flux audio direct. Consomme le quota fournisseur. La demande peut être annulée avec la connexion HTTP. L’app utilise une voix locale si cette synthèse échoue.",
  "SpeechResult",
  {
    effect: "provider",
    input: "SpeechRequest",
    example: { text: "La suite est prête." },
    responses: unavailable,
  },
);

for (const [path, operationId, mime, summary] of [
  ["/dj/player", "getYouTubePlayer", "text/html", "Lecteur public YouTube"],
  [
    "/dj/player.js",
    "getYouTubePlayerScript",
    "text/javascript",
    "Script du lecteur",
  ],
  ["/dj/player.css", "getYouTubePlayerStyle", "text/css", "Style du lecteur"],
] as const)
  add(
    "get",
    path,
    operationId,
    "Lecteur et distribution",
    summary,
    "Ressource publique utilisée par WebKit ; ne reçoit aucun jeton privé ni clé Gemini. Les contrôles du lecteur ne sont pas des endpoints REST. Le paramètre native=1 active le mode discret prévu par l’app.",
    {},
    {
      public: true,
      responses: { "200": text(mime, summary) },
      ...(path === "/dj/player"
        ? {
            parameters: [
              parameter("native", "query", { type: "string", enum: ["1"] }),
            ],
          }
        : {}),
    },
  );
add(
  "get",
  "/macos/appcast.xml",
  "getMacUpdateFeed",
  "Lecteur et distribution",
  "Flux de mises à jour Mac",
  "Flux Sparkle public. Un flux vide est normal tant qu’aucune archive signée n’a été volontairement publiée. Une installation locale n’active pas automatiquement une mise à jour publique.",
  {},
  {
    public: true,
    responses: {
      "200": text("application/rss+xml", "Flux Sparkle"),
      "503": text("text/plain", "Flux temporairement indisponible"),
    },
  },
);
add(
  "get",
  "/macos/{archive}",
  "downloadMacArchive",
  "Lecteur et distribution",
  "Télécharger une archive publiée",
  "Uniquement les archives ZIP nommées Playlist-Recall-version-architecture.zip présentes dans le répertoire de publication. Le nom technique historique reste stable malgré la marque Sillage.",
  {},
  {
    public: true,
    parameters: [
      id(
        "archive",
        "Nom exact de l’archive publiée",
        "^Playlist-Recall-[0-9]+\\.[0-9]+\\.[0-9]+-(arm64|x86_64|universal)\\.zip$",
      ),
    ],
    responses: {
      "200": {
        description: "Archive ZIP",
        content: {
          "application/zip": { schema: { type: "string", format: "binary" } },
        },
      },
      "404": text("text/plain", "Archive absente ou nom refusé"),
    },
  },
);

// The journal remains private to the authenticated account, including developer tokens.
add(
  "get",
  "/v1/dj/conversations",
  "getDjConversations",
  "Journal DJ",
  "Lister les conversations",
  "Conversations de ton compte uniquement, paginées de la plus récente à la plus ancienne. Les messages réels du client et les tours du serveur sont comptés séparément.",
  object({
    conversations: array(ref("JournalConversation")),
    nextCursor: { type: ["string", "null"], format: "uuid" },
  }),
  { parameters: query("JournalPage") },
);
add(
  "get",
  "/v1/dj/conversations/{conversationId}/turns",
  "getDjConversationTurns",
  "Journal DJ",
  "Lire les tours du DJ",
  "Mode effectif et demandé, modèle, action finale, erreurs, statut et complétude du journal. stale indique un tour resté en cours plus de cinq minutes, par exemple après un arrêt du serveur.",
  object({
    turns: array(ref("JournalTurnSummary")),
    nextCursor: { type: ["string", "null"], format: "uuid" },
  }),
  {
    parameters: [
      id("conversationId", "UUID de la conversation"),
      ...query("JournalPage"),
    ],
    responses: { "404": error("Conversation inconnue pour ce compte") },
  },
);
add(
  "get",
  "/v1/dj/conversations/{conversationId}/events",
  "getDjConversationEvents",
  "Journal DJ",
  "Lire messages, outils et actions",
  "Journal chronologique par ordre de réception. Après une reconnexion, utiliser occurredAt et clientSequence pour l’ordre réel des actions du Mac. payload contient le texte original, les propositions, l’état de file ou l’appel d’outil ; aucun masquage de contenu. Le champ requestId des événements client correspond au request_id du tour serveur.",
  object({
    events: array(ref("JournalEvent")),
    nextCursor: { type: ["string", "null"] },
  }),
  {
    parameters: [
      id("conversationId", "UUID de la conversation"),
      ...query("JournalEventPage"),
    ],
    responses: { "404": error("Conversation inconnue pour ce compte") },
  },
);
add(
  "post",
  "/v1/dj/conversations/{conversationId}/events",
  "recordDjConversationEvents",
  "Journal DJ",
  "Enregistrer les actions et messages de l’app",
  "Lot de 1 à 50 événements. Identifiant stable par événement : renvoyer un lot après une coupure ne crée pas de doublons. Le serveur impose origin=client et le propriétaire authentifié ; le client ne peut pas fabriquer une trace serveur.",
  object({ recorded: integer }),
  {
    effect: "write",
    input: "JournalUpload",
    parameters: [id("conversationId", "UUID de la conversation")],
    example: {
      events: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          sequence: 1,
          occurredAt: "2026-10-26T12:00:00Z",
          scope: "all",
          visibleScope: "all",
          kind: "message",
          role: "user",
          content: "Prépare cinq morceaux à la suite",
          queueIds: [],
        },
      ],
    },
  },
);
add(
  "get",
  "/v1/dj/turns/{turnId}",
  "getDjTurn",
  "Journal DJ",
  "Inspecter un tour et ses appels",
  "Entrée validée, contexte, décision, réponse finale et tours du fournisseur avec noms, arguments, résultats et durées des outils. Les champs historiques de la ligne SQL utilisent snake_case. Les clés configurées, en-têtes d’authentification et signatures internes du fournisseur ne sont pas collectés.",
  object({
    turn: ref("JournalTurn"),
    events: array(
      object({
        sequence: string(),
        kind: string(),
        payload: { type: "object", additionalProperties: true },
        receivedAt: { type: "string", format: "date-time" },
      }),
    ),
  }),
  {
    parameters: [id("turnId", "UUID renvoyé dans X-Sillage-Trace-Id")],
    responses: { "404": error("Tour inconnu pour ce compte") },
  },
);
add(
  "delete",
  "/v1/dj/conversations/{conversationId}",
  "deleteDjConversation",
  "Journal DJ",
  "Effacer une conversation et ses traces",
  "Effacement définitif de cette conversation du compte uniquement. Ne touche ni aux playlists, ni à l’historique d’écoute, ni à la clé Gemini. Les sauvegardes suivent leur propre rétention.",
  object({ deleted: { const: true } }),
  {
    effect: "write",
    parameters: [id("conversationId", "UUID de la conversation à effacer")],
    responses: { "404": error("Conversation inconnue pour ce compte") },
  },
);

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
  paths,
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
    schemas: { ...schemas, ...generated.components.schemas },
  },
};
