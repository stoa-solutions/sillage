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
  return Object.entries(schema.properties as Record<string, Schema>).map(
    ([key, value]) =>
      parameter(
        key,
        "query",
        value,
        (schema.required as string[] | undefined)?.includes(key) ?? false,
      ),
  );
};
const unavailable = {
  "502": error("Fournisseur temporairement indisponible"),
  "503": error("Configuration ou service indisponible"),
};
const paths: Record<string, Partial<Record<Method, Operation>>> = {};

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
add(
  "get",
  "/auth/status",
  "getAuthStatus",
  "Connexion Google",
  "Disponibilité de Google",
  "Indique si la connexion Google est configurée, sans exposer d’identifiant privé.",
  object({ google: boolean }),
  { public: true },
);
add(
  "get",
  "/auth/google/start",
  "startGoogleSignIn",
  "Connexion Google",
  "Commencer la connexion",
  "À ouvrir dans le navigateur système. Le Mac crée un verifier PKCE et app_state, puis envoie SHA-256(verifier) en base64url comme challenge. Le serveur pose un cookie Secure HttpOnly SameSite=Lax et redirige vers Google. Flux valable 10 minutes. Scopes : openid, email, profile ; aucun accès aux playlists YouTube.",
  {},
  {
    public: true,
    status: "",
    effect: "browser",
    parameters: query("AuthStart"),
    responses: {
      "302": {
        description: "Redirection Google",
        headers: {
          Location: { schema: string() },
          "Set-Cookie": {
            schema: string(),
            description:
              "__Host-recall-auth ; Secure ; HttpOnly ; SameSite=Lax ; Path=/",
          },
        },
      },
      "429": error("Plus de 60 démarrages par minute"),
      "503": error("Google non configuré"),
    },
  },
);
add(
  "get",
  "/auth/google/callback",
  "completeGoogleSignIn",
  "Connexion Google",
  "Retour du navigateur Google",
  "Google fournit code et state ; le cookie du démarrage est obligatoire. Vérification de l’identité et du nonce, puis retour HTML vers playlist-recall://auth?code=…&state=…. Le code de retour Sillage est à usage unique, valable 90 secondes et lié au challenge PKCE. Il ne s’agit ni d’une clé Google ni du jeton API. Ne pas rejouer manuellement le callback hors du flux navigateur.",
  {},
  {
    public: true,
    effect: "browser",
    security: [{ googleFlowCookie: [] }],
    parameters: [
      parameter("state", "query", { type: "string", maxLength: 128 }, true),
      parameter("code", "query", { type: "string", maxLength: 4096 }, true),
    ],
    responses: {
      "200": text("text/html", "Page de retour vers l’app Mac"),
      "400": text(
        "text/plain",
        "Connexion annulée, expirée ou identité non confirmée",
      ),
    },
  },
);
add(
  "post",
  "/auth/exchange",
  "exchangeSignInGrant",
  "Connexion Google",
  "Échanger le code contre une session",
  "L’app échange le code Sillage reçu par son lien de retour et son verifier PKCE. Usage unique. Le jeton retourné est conservé dans le fichier privé de session du Mac ; le serveur conserve son empreinte. Validité 90 jours, prolongée à l’usage lorsque moins de 60 jours restent.",
  object({
    token: string(
      "Secret de session : ne jamais journaliser, exporter ou committer.",
    ),
  }),
  {
    public: true,
    effect: "write",
    input: "AuthExchange",
    example: { code: "{{auth_code}}", verifier: "{{pkce_verifier}}" },
    responses: {
      "401": error("Code expiré, réutilisé ou verifier incorrect"),
      "413": text("text/plain", "Corps supérieur à 8 Kio"),
    },
  },
);

add(
  "get",
  "/v1/me",
  "getAccount",
  "Compte",
  "Compte courant",
  "Compte associé au jeton Bearer. Chaque session détermine son userId côté serveur ; un client ne peut pas choisir le compte d’un autre utilisateur.",
  "Account",
);
add(
  "post",
  "/v1/logout",
  "revokeSession",
  "Compte",
  "Déconnecter cette session",
  "Révoque le jeton utilisé pour cet appel. Les autres sessions du compte restent actives.",
  "Saved",
  { effect: "write" },
);
add(
  "post",
  "/v1/account/claim-library",
  "claimLegacyLibrary",
  "Compte",
  "Récupérer la bibliothèque historique",
  "Transfert à usage unique vers un compte Google, avec preuve du jeton historique. Transfère aussi l’historique et les jetons concernés. Ne sert pas à partager des bibliothèques entre comptes ordinaires.",
  "Saved",
  {
    effect: "write",
    input: object({
      legacyToken: { type: "string", minLength: 20, maxLength: 256 },
    }),
    example: { legacyToken: "{{legacy_token}}" },
    responses: { "403": error("Transfert déjà effectué ou preuve invalide") },
  },
);

add(
  "get",
  "/v1/status",
  "getLibraryStatus",
  "Bibliothèque",
  "État de la bibliothèque et du worker",
  "Compteurs de vidéos, index et tâches visibles pour le compte courant. Les tâches des autres comptes ne sont pas listées.",
  "LibraryStatus",
);
add(
  "get",
  "/v1/playlists",
  "listPlaylists",
  "Bibliothèque",
  "Playlists du compte",
  "Instantanés des playlists rattachées au compte et nombre d’entrées actives. Ce ne sont pas des droits d’écriture sur YouTube.",
  object({ playlists: array(ref("Playlist")) }),
);
add(
  "post",
  "/v1/playlists",
  "importYouTubePlaylist",
  "Bibliothèque",
  "Importer une playlist par lien",
  "Ajoute le rattachement au compte puis programme une synchronisation. 202 signifie tâche créée, pas import terminé. Playlists publiques ou non répertoriées ; pas d’OAuth YouTube. Un import incomplet conserve l’instantané précédent.",
  "PlaylistAccepted",
  {
    status: "202",
    effect: "write",
    input: object({ url: { type: "string", minLength: 1, maxLength: 500 } }),
    example: { url: "https://www.youtube.com/playlist?list={{playlist_id}}" },
  },
);
add(
  "delete",
  "/v1/playlists/{id}",
  "removePlaylist",
  "Bibliothèque",
  "Retirer une playlist du compte",
  "Retire uniquement le rattachement Sillage du compte courant. Ne supprime rien sur YouTube ni chez les autres comptes. Les morceaux restent accessibles si une autre playlist du compte les contient. Retirer Mes découvertes vide cette collection privée.",
  object({ removed: string() }),
  {
    effect: "write",
    parameters: [id("id", "Identifiant de playlist Sillage ou YouTube")],
    responses: { "404": error("Playlist inconnue pour ce compte") },
  },
);
add(
  "post",
  "/v1/playlists/{id}/sync",
  "syncYouTubePlaylist",
  "Bibliothèque",
  "Actualiser une playlist YouTube",
  "Programme une synchronisation idempotente. Lire ensuite les tâches et la liste de playlists pour vérifier l’achèvement. Ne pas appeler pour Mes découvertes, qui n’a pas de source YouTube.",
  "SyncAccepted",
  {
    status: "202",
    effect: "write",
    parameters: [
      id("id", "Identifiant d’une playlist YouTube déjà rattachée au compte"),
    ],
    responses: { "404": error("Playlist inconnue pour ce compte") },
  },
);
add(
  "post",
  "/v1/search",
  "searchLibrary",
  "Recherche",
  "Chercher dans les playlists",
  "Recherche hybride lexicale/vectorielle et métadonnées MusicBrainz dans les appartenances actives du compte. mode=image rapproche les miniatures indexées. offset/limit paginent la bibliothèque ; un index indisponible peut fournir des résultats avec degraded. Aucun appel de recherche YouTube via cette route.",
  "SearchPage",
  {
    input: "LibrarySearch",
    example: {
      query: "Mac Miller",
      mode: "text",
      sort: "relevance",
      offset: 0,
      limit: 25,
    },
  },
);
add(
  "get",
  "/v1/library/enrichment",
  "getEnrichmentProgress",
  "Bibliothèque",
  "Avancement MusicBrainz",
  "Compteurs propres au compte : matched, ambiguous, not_found, attente YouTube, tâches et erreurs. processed indique une décision d’enrichissement, pas forcément une correspondance certaine. Les genres d’artiste ne prouvent pas le genre du morceau.",
  "Enrichment",
);
add(
  "get",
  "/v1/export",
  "exportLibrary",
  "Bibliothèque",
  "Exporter la bibliothèque",
  "Export Recall JSON version 1 au format collections/playlist/videos, limité au compte. Aucun jeton ni clé Gemini n’est inclus.",
  "LibraryExport",
);
add(
  "post",
  "/v1/import",
  "importLegacyBackup",
  "Maintenance",
  "Importer une sauvegarde JSON",
  "Réservé au compte de maintenance historique. Un utilisateur Google importe une playlist via /v1/playlists. Accepte les exports Recall, playlists normalisées et playlists plates yt-dlp ; validations avant la transaction.",
  object({ playlists: integer, videos: integer }),
  {
    effect: "write",
    input: "LibraryImport",
    example: {
      format: "playlist-recall",
      version: 1,
      collections: [
        { playlist: { id: "playlist_example", title: "Exemple" }, videos: [] },
      ],
    },
    responses: { "403": error("Maintenance uniquement") },
  },
);
add(
  "post",
  "/v1/jobs/retry",
  "retryFailedJobs",
  "Maintenance",
  "Relancer les tâches échouées",
  "Réservé au compte historique de maintenance. Relance les dernières tâches en échec sans dupliquer une tâche active. Opération globale de maintenance, pas une action de playlist ordinaire.",
  object({ retried: integer }),
  {
    status: "202",
    effect: "write",
    responses: { "403": error("Maintenance uniquement") },
  },
);

add(
  "get",
  "/v1/discover/home",
  "getDiscoveryHome",
  "Découvrir",
  "Suggestions selon l’historique",
  "Relit les 80 dernières écoutes du compte. Parmi les 20 écoutes finished/replaced les plus récentes, extrait au plus 3 pistes artiste/genre MusicBrainz. Cherche ces pistes, écarte les vidéos déjà possédées ou récemment écoutées et entrelace au plus 12 suggestions. Heuristique sans appel Gemini, pas apprentissage de goûts collaboratif. Pas d’historique : emptyReason et suggestions vides.",
  "DiscoveryHome",
  { effect: "provider", responses: unavailable },
);
add(
  "post",
  "/v1/discover/search",
  "searchYouTube",
  "Découvrir",
  "Chercher des morceaux sur YouTube",
  "SearXNG privé si configuré, sinon YouTube search.list. Les vidéos sont vérifiées par YouTube ; inLibrary est recalculé pour chaque compte. Cache public des requêtes de 5 minutes, maximum 100 entrées ; demandes identiques partagées, 4 recherches distinctes simultanées. pageToken est opaque et doit être renvoyé tel quel.",
  "DiscoveryPage",
  {
    effect: "provider",
    input: "DiscoverySearch",
    example: { query: "Mac Miller", pageToken: "" },
    responses: {
      ...unavailable,
      "429": error(
        "Quota, budget ou recherche occupée ; reason et retryAt précisent la limite",
      ),
    },
  },
);
add(
  "post",
  "/v1/discover/add",
  "saveDiscovery",
  "Découvrir",
  "Ajouter à Mes découvertes",
  "Revérifie l’identifiant sur YouTube, enregistre dans la collection privée du compte, puis programme les index texte et image si activés. Ajout idempotent. Ne modifie aucune playlist YouTube. L’enrichissement MusicBrainz est ensuite pris en charge par le worker pour les comptes activés.",
  "DiscoverySaved",
  {
    effect: "write",
    input: "DiscoveryAdd",
    example: { videoId: "{{video_id}}" },
    responses: {
      ...unavailable,
      "404": error("Vidéo absente ou inaccessible"),
    },
  },
);

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
  "Retourne les capacités configurées et le modèle sélectionné, sans jamais renvoyer la clé. personal distingue les réglages du compte du mode historique.",
  "DjStatus",
);
add(
  "post",
  "/v1/dj/settings",
  "saveDjSettings",
  "DJ",
  "Enregistrer sa clé ou changer de modèle",
  "La première configuration exige apiKey. Ensuite model seul conserve la clé existante. Chiffrement AES-256-GCM côté serveur avec contexte du compte ; clé jamais renvoyée. L’enregistrement ne vérifie pas Google : utiliser /check pour tester, ce qui consomme le quota du fournisseur.",
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
  "Supprime les réglages et la clé chiffrée du compte courant. Le DJ d’un utilisateur Google sera à reconfigurer ; les playlists restent disponibles.",
  "Saved",
  { effect: "write" },
);
add(
  "post",
  "/v1/dj/check",
  "checkDjProvider",
  "DJ",
  "Tester clé, modèle et voix",
  "Appel réel à Google, sans enregistrer les paramètres fournis. Sans apiKey, teste la clé existante. ok=false ou voice=false peuvent être retournés avec HTTP 200 : lire le résultat métier. Une seule opération DJ par compte et deux au maximum sur cette instance.",
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
  "scope est la source explicite : library, youtube ou all. Le serveur exécute les outils puis retourne une opération validée ; le Mac joue ensuite les tracks. replace remplace maintenant, append ajoute sans interrompre, keep conserve la lecture. discoveries propose des cartes ; sources accompagne une recherche d’information. Envoyer playbackContext, historique et exclusions pour une suite cohérente. Aucun ajout à la bibliothèque par cette route. Une opération DJ simultanée par compte ; 429 peut signifier occupé, pas forcément quota épuisé.",
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

add(
  "post",
  "/v1/history",
  "recordListeningEvents",
  "Historique",
  "Enregistrer des écoutes",
  "1 à 100 événements par lot. L’identifiant UUID de chaque événement rend les réémissions idempotentes pour ce compte. finished, skipped, unavailable et replaced sont conservés ; pas de suivi audio implicite.",
  object({ recorded: integer }),
  {
    effect: "write",
    input: "HistoryUpload",
    example: {
      events: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          videoId: "video000001",
          title: "Titre de test",
          channel: "Artiste de test",
          outcome: "finished",
          playedAt: "2026-10-26T09:00:00Z",
        },
      ],
    },
  },
);
add(
  "get",
  "/v1/history",
  "listListeningEvents",
  "Historique",
  "Lire l’historique",
  "Tri décroissant par playedAt et id. Pagination par curseur : reprendre playedAt et id de la dernière ligne dans before et beforeId. beforeId exige before. Valeur par défaut : 50 ; maximum : 200.",
  object({ events: array(ref("HistoryEvent")) }),
  { parameters: query("HistoryPage") },
);
add(
  "delete",
  "/v1/history",
  "clearListeningHistory",
  "Historique",
  "Effacer l’historique du compte",
  "Supprime uniquement les événements d’écoute du compte courant ; cela réduit les signaux disponibles pour l’accueil Découvrir.",
  object({ deleted: integer }),
  { effect: "write" },
);
add(
  "get",
  "/v1/lyrics/{videoId}",
  "getLyrics",
  "Paroles",
  "Paroles du morceau",
  "Réservé aux vidéos présentes dans les playlists du compte. Cherche/cache LRCLIB et applique la correction personnelle. missing et unavailable sont des états métier en HTTP 200. Le clic temporel et le rendu restent gérés par le lecteur Mac.",
  "Lyrics",
  {
    effect: "provider",
    parameters: [
      id(
        "videoId",
        "Vidéo appartenant à la bibliothèque du compte",
        "^[A-Za-z0-9_-]{11}$",
      ),
    ],
    responses: { "404": error("Vidéo absente de la bibliothèque") },
  },
);
add(
  "post",
  "/v1/lyrics/{videoId}/offset",
  "saveLyricsOffset",
  "Paroles",
  "Caler les paroles",
  "Correction personnelle en millisecondes, entre −30 000 et +30 000. Une valeur positive retarde les paroles. Ne modifie pas les corrections des autres comptes.",
  object({ offsetMs: integer }),
  {
    effect: "write",
    parameters: [
      id(
        "videoId",
        "Vidéo appartenant à la bibliothèque du compte",
        "^[A-Za-z0-9_-]{11}$",
      ),
    ],
    input: object({
      offsetMs: { type: "integer", minimum: -30000, maximum: 30000 },
    }),
    example: { offsetMs: 0 },
    responses: { "404": error("Vidéo absente de la bibliothèque") },
  },
);

add(
  "post",
  "/v1/mcp",
  "callMusicMcp",
  "Outils MCP",
  "Appeler un outil musical MCP",
  "Transport Streamable HTTP stateless, authentifié avec le même Bearer que l’API. JSON-RPC 2.0 : initialisation, tools/list puis tools/call selon le client MCP. Catalogue limité au compte ; outils de recherche en lecture seule. Le DJ utilise en interne une connexion MCP en mémoire. MCP n’est pas un endpoint REST pour chaque outil.",
  "RpcResponse",
  {
    effect: "provider",
    input: "RpcRequest",
    example: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "Sillage Postman", version: "1.0.0" },
      },
    },
    "x-sillage-accept": "application/json, text/event-stream",
    responses: { "202": { description: "Notification acceptée sans corps" } },
  },
);
for (const method of ["get", "delete"] as const)
  add(
    method,
    "/v1/mcp",
    `${method}MusicMcp`,
    "Outils MCP",
    "Méthode MCP non disponible en mode stateless",
    "Le transport monté reçoit cette méthode mais ne maintient aucune session ni flux SSE à reprendre. Utiliser POST avec un client MCP.",
    {},
    {
      status: "",
      responses: { "405": json("RpcResponse", "Méthode non prise en charge") },
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
    schemas,
  },
};
