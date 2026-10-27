import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import type { Database } from "../../db/index.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonBody,
  jsonResponse,
  operation,
  savedBody,
} from "../../shared/openapi.ts";
import { checkDj } from "./dj-check.service.ts";
import { providerBaseUrl } from "./dj.config.ts";
import {
  aiProviderStatus,
  personalDjConfig,
  resetDjSettings,
  saveDjSettings,
  settingsKey,
} from "./dj-settings.service.ts";
import { djSpeech, djVoiceConfigured } from "./dj-voice.service.ts";
import {
  checkResultBody,
  djCheckBody,
  djRequestBody,
  djResetBody,
  djResponseBody,
  djSettingsBody,
  djStatusBody,
  rulesBody,
  speechRequestBody,
  speechResultBody,
} from "./dj.schemas.ts";
import { DjUnavailable } from "./errors.ts";
import { journalRoutes } from "./journal/journal.controller.ts";
import {
  beginJournal,
  loadConversationMemory,
  publicJournalError,
  type TurnStatus,
} from "./journal/journal.service.ts";
import {
  TurnDeadline,
  TurnLeases,
  TurnRefused,
  TurnSuperseded,
} from "./dj-lease.ts";
import { planTurn } from "./plan.ts";
import { djSystemPrompt } from "./prompt.ts";
import { djTurn } from "./dj-turn.service.ts";
import { djAgentsService } from "../dj-agents/index.ts";

const TAG = "DJ";
const unavailableResponses = {
  502: errorResponse("Fournisseur temporairement indisponible"),
  503: errorResponse("Configuration ou service indisponible"),
};
const rulesRoute = createRoute({
  method: "get",
  path: "/rules",
  ...operation({
    operationId: "getDjRules",
    tag: TAG,
    summary: "Prompt système actuel",
    description:
      "Règles de l’agent côté serveur, consultables par un compte connecté. Cette route ne modifie pas le prompt.",
  }),
  responses: { ...commonErrors(), 200: jsonResponse(rulesBody, "Réponse réussie") },
});
const statusRoute = createRoute({
  method: "get",
  path: "/status",
  ...operation({
    operationId: "getDjStatus",
    tag: TAG,
    summary: "État du modèle et de la voix",
    description:
      "Retourne le fournisseur actif, le catalogue et les capacités de chaque fournisseur, sans jamais renvoyer les clés. personal distingue les réglages du compte du mode historique.",
  }),
  responses: { ...commonErrors(), 200: jsonResponse(djStatusBody, "Réponse réussie") },
});
const settingsExample = { apiKey: "{{gemini_api_key}}", model: "gemini-3.5-flash-lite" };
const settingsRoute = createRoute({
  method: "post",
  path: "/settings",
  ...operation({
    operationId: "saveDjSettings",
    tag: TAG,
    summary: "Enregistrer sa clé ou changer de modèle",
    description:
      "provider vaut google par défaut pour les clients existants. La première configuration de chaque fournisseur exige apiKey ; ensuite model seul conserve sa clé. Changer de fournisseur conserve les autres clés et modèles. Chiffrement AES-256-GCM côté serveur avec contexte du compte ; clé jamais renvoyée. L’enregistrement ne vérifie pas le fournisseur : utiliser /check pour tester, ce qui consomme le quota du fournisseur.",
    effect: "write",
    example: settingsExample,
  }),
  request: { body: jsonBody(djSettingsBody, settingsExample) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(savedBody, "Réponse réussie"),
    503: errorResponse("Chiffrement des réglages non configuré"),
  },
});
const resetRoute = createRoute({
  method: "post",
  path: "/settings/reset",
  ...operation({
    operationId: "resetDjSettings",
    tag: TAG,
    summary: "Supprimer la clé enregistrée du compte",
    description:
      "Avec provider, supprime uniquement sa clé ; sans provider, supprime toutes les clés du compte courant. Aucun changement automatique de fournisseur après suppression. Le DJ d’un utilisateur Google sera à reconfigurer ; les playlists restent disponibles.",
    effect: "write",
    example: { provider: "google" },
  }),
  request: { body: jsonBody(djResetBody, { provider: "google" }) },
  responses: { ...commonErrors(), 200: jsonResponse(savedBody, "Réponse réussie") },
});
const checkExample = { model: "gemini-3.5-flash-lite", voice: false };
const checkRoute = createRoute({
  method: "post",
  path: "/check",
  ...operation({
    operationId: "checkDjProvider",
    tag: TAG,
    summary: "Tester clé, modèle et voix",
    description:
      "Appel réel au fournisseur sélectionné (google par défaut), sans enregistrer les paramètres fournis. Sans apiKey, teste uniquement sa clé existante. Avec Claude, voice reste false : la voix macOS est locale. ok=false ou voice=false peuvent être retournés avec HTTP 200 : lire le résultat métier. Une seule opération DJ par compte et deux au maximum sur cette instance.",
    effect: "provider",
    example: checkExample,
  }),
  request: { body: jsonBody(djCheckBody, checkExample) },
  responses: { ...commonErrors(), 200: jsonResponse(checkResultBody, "Réponse réussie") },
});
const chatExample = {
  message: "Propose du jazz sans lancer la lecture.",
  scope: "library",
  history: [],
  excludeIds: [],
  discoveryContext: [],
  rejectedIds: [],
};
const chatRoute = createRoute({
  method: "post",
  path: "/chat",
  ...operation({
    operationId: "askDj",
    tag: TAG,
    summary: "Demander au DJ",
    description:
      "scope est la source explicite : library, youtube ou all. Le serveur exécute les outils puis retourne une opération validée ; le Mac joue ensuite les tracks. replace remplace maintenant, append ajoute sans interrompre, keep conserve la lecture. discoveries propose des cartes ; sources accompagne une recherche d’information. Envoyer playbackContext, historique et exclusions pour une suite cohérente. conversationId et requestId optionnels relient le chat aux actions du client ; trigger distingue demande et continuation. X-Sillage-Trace-Id identifie le tour, X-Sillage-Journal vaut saved ou unavailable sans changer la réponse JSON. Aucun ajout à la bibliothèque par cette route. Une opération DJ simultanée par compte ; 429 peut signifier occupé, pas forcément quota épuisé.",
    effect: "provider",
    example: chatExample,
  }),
  request: { body: jsonBody(djRequestBody, chatExample) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(djResponseBody, "Réponse réussie"),
    ...unavailableResponses,
    409: errorResponse("Tour remplacé par une demande plus récente ou suite refusée"),
    504: errorResponse("Délai du tour dépassé ; la file de lecture est conservée"),
  },
});
const speechRoute = createRoute({
  method: "post",
  path: "/speech",
  ...operation({
    operationId: "synthesizeDjSpeech",
    tag: TAG,
    summary: "Préparer une annonce vocale",
    description:
      "Synthèse vocale Gemini avec la clé du compte ; renvoie un WAV encodé en base64, pas un flux audio direct. Consomme le quota fournisseur. La demande peut être annulée avec la connexion HTTP. L’app utilise une voix locale si cette synthèse échoue.",
    effect: "provider",
    example: { text: "La suite est prête." },
  }),
  request: { body: jsonBody(speechRequestBody, { text: "La suite est prête." }) },
  responses: {
    ...commonErrors(),
    200: jsonResponse(speechResultBody, "Réponse réussie"),
    ...unavailableResponses,
  },
});

/** Writing the final journal status never holds a response for long. */
const JOURNAL_FINISH_MS = 5_000;

function unavailable(c: Context<ApiEnvironment>, error: unknown) {
  if (error instanceof DjUnavailable)
    return c.json({ error: error.message }, error.status);
  throw error;
}

export function createDjRoutes(
  db: Database,
  leases = new TurnLeases({
    capacity: Number(process.env["DJ_CONCURRENT_TURNS"]) || 2,
  }),
) {
  const app = featureRouter<ApiEnvironment>();
  const agents = djAgentsService(db);
  app.route("/", journalRoutes(db));
  app.openapi(rulesRoute, (c) => c.json({ prompt: djSystemPrompt }, 200));
  app.openapi(statusRoute, async (c) => {
    const config = await personalDjConfig(db, c.get("userId"));
    return c.json({
      configured: config.configured,
      provider: config.provider === "anthropic" ? ("anthropic" as const) : ("google" as const),
      providers: await aiProviderStatus(db, c.get("userId")),
      voice: djVoiceConfigured(config),
      model: config.model ?? null,
      personal: config.personal,
      settingsAvailable: Boolean(settingsKey()),
    }, 200);
  });
  app.openapi(settingsRoute, async (c) => {
    const input = c.req.valid("json");
    const result = await saveDjSettings(db, c.get("userId"), input);
    if (result === "missing-key")
      return c.json(
        { error: "Renseigne la clé de ce fournisseur une première fois." },
        400,
      );
    if (result === "unavailable")
      return c.json(
        { error: "Le serveur doit activer le stockage sécurisé des clés." },
        503,
      );
    return c.json({ saved: true as const }, 200);
  });
  app.openapi(resetRoute, async (c) => {
    const { provider } = c.req.valid("json");
    await resetDjSettings(db, c.get("userId"), provider);
    return c.json({ saved: true as const }, 200);
  });

  /** A settings check never interrupts the listener's own turn. */
  app.openapi(checkRoute, async (c) => {
    const input = c.req.valid("json");
    const user = c.get("userId");
    if (leases.busy(user))
      return c.json(
        { error: "Le DJ est occupé. Réessaie après sa réponse." },
        429,
      );
    let lease;
    try {
      lease = await leases.acquire(user, "user", c.req.raw.signal);
    } catch (error) {
      if (error instanceof TurnRefused)
        return c.json({ error: error.message }, 429);
      throw error;
    }
    try {
      const stored = await personalDjConfig(db, user, input.provider);
      const config = {
        ...stored,
        model: input.model,
        ...(input.apiKey
          ? {
              key: input.apiKey,
              configured: true,
              provider: input.provider,
              baseUrl: providerBaseUrl(input.provider),
            }
          : {}),
      };
      return c.json(await checkDj(db, config, user, input.voice), 200);
    } finally {
      lease.release();
    }
  });

  app.openapi(chatRoute, async (c) => {
    const input = c.req.valid("json");
    const user = c.get("userId");
    const agent = await agents.resolve(user, input.agentId);
    const journal = await beginJournal(
      db,
      user,
      c.get("installationId"),
      input,
      agent.trace,
    );
    c.header("X-Sillage-Trace-Id", journal.id);
    async function finish(
      status: TurnStatus,
      response: unknown,
      model?: string,
    ) {
      const saved = await Promise.race([
        journal.finish(status, response, model),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), JOURNAL_FINISH_MS),
        ),
      ]);
      c.header("X-Sillage-Journal", saved ? "saved" : "unavailable");
    }

    let lease;
    try {
      lease = await leases.acquire(
        user,
        planTurn(input).trigger,
        c.req.raw.signal,
      );
    } catch (error) {
      if (!(error instanceof TurnRefused)) throw error;
      const status = error.reason === "saturated" ? 503 : 409;
      await finish("busy", { error: error.message, status });
      return c.json({ error: error.message }, status);
    }

    let model: string | undefined;
    try {
      const config = await personalDjConfig(db, user);
      model = config.model;
      const memory = await loadConversationMemory(
        db,
        user,
        journal.conversationId,
        journal.id,
      );
      const response = await djTurn(
        db,
        input,
        lease.signal,
        config,
        user,
        journal.observe,
        memory,
        agent.profile,
      );
      await finish("completed", response, model);
      return c.json(response, 200);
    } catch (error) {
      const reason = lease.signal.reason;
      if (reason instanceof TurnSuperseded) {
        await finish("superseded", { error: reason.message, status: 409 }, model);
        return c.json({ error: reason.message }, 409);
      }
      if (reason instanceof TurnDeadline) {
        const message = `${reason.message} Ta file de lecture est conservée.`;
        await finish("error", { error: message, status: 504 }, model);
        return c.json({ error: message }, 504);
      }
      await finish(
        c.req.raw.signal.aborted ? "canceled" : "error",
        publicJournalError(error),
        model,
      );
      return unavailable(c, error);
    } finally {
      // Release only after the final status is written, so the next turn's
      // memory sees how this one ended.
      lease.release();
    }
  });

  // Speech reads an existing reply aloud: it only counts against the daily quota.
  app.openapi(speechRoute, async (c) => {
    const { text } = c.req.valid("json");
    try {
      return c.json(
        await djSpeech(
          db,
          text,
          c.req.raw.signal,
          await personalDjConfig(db, c.get("userId")),
          c.get("userId"),
        ),
        200,
      );
    } catch (error) {
      return unavailable(c, error);
    }
  });
  return app;
}
