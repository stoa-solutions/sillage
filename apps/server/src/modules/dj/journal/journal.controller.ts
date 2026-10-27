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
} from "../../../shared/openapi.ts";
import {
  conversationExists,
  deleteConversation,
  listConversations,
  listEvents,
  listTurns,
  turnWithEvents,
} from "./journal.repository.ts";
import {
  conversationParam,
  conversationsBody,
  deletedBody,
  eventsBody,
  journalEventPageQuery,
  journalPageQuery,
  journalUploadBody,
  recordedBody,
  turnDetailBody,
  turnParam,
  turnsBody,
} from "./journal.schemas.ts";
import { uploadJournalEvents } from "./journal.service.ts";

// The journal remains private to the authenticated account, including developer tokens.
const TAG = "Journal DJ";
const unknownConversation = errorResponse("Conversation inconnue pour ce compte");
const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

const conversationsRoute = createRoute({
  method: "get",
  path: "/conversations",
  ...operation({
    operationId: "getDjConversations",
    tag: TAG,
    summary: "Lister les conversations",
    description:
      "Conversations de ton compte uniquement, paginées de la plus récente à la plus ancienne. Les messages réels du client et les tours du serveur sont comptés séparément.",
  }),
  request: { query: journalPageQuery },
  responses: {
    ...commonErrors(),
    200: jsonResponse(conversationsBody, "Réponse réussie"),
  },
});
const turnsRoute = createRoute({
  method: "get",
  path: "/conversations/{conversationId}/turns",
  ...operation({
    operationId: "getDjConversationTurns",
    tag: TAG,
    summary: "Lire les tours du DJ",
    description:
      "Mode effectif et demandé, modèle, action finale, erreurs, statut et complétude du journal. stale indique un tour resté en cours plus de cinq minutes, par exemple après un arrêt du serveur.",
  }),
  request: {
    params: conversationParam("UUID de la conversation"),
    query: journalPageQuery,
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(turnsBody, "Réponse réussie"),
    404: unknownConversation,
  },
});
const eventsRoute = createRoute({
  method: "get",
  path: "/conversations/{conversationId}/events",
  ...operation({
    operationId: "getDjConversationEvents",
    tag: TAG,
    summary: "Lire messages, outils et actions",
    description:
      "Journal chronologique par ordre de réception. Après une reconnexion, utiliser occurredAt et clientSequence pour l’ordre réel des actions du Mac. payload contient le texte original, les propositions, l’état de file ou l’appel d’outil ; aucun masquage de contenu. Le champ requestId des événements client correspond au request_id du tour serveur.",
  }),
  request: {
    params: conversationParam("UUID de la conversation"),
    query: journalEventPageQuery,
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(eventsBody, "Réponse réussie"),
    404: unknownConversation,
  },
});
const uploadExample = {
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
};
const uploadRoute = createRoute({
  method: "post",
  path: "/conversations/{conversationId}/events",
  ...operation({
    operationId: "recordDjConversationEvents",
    tag: TAG,
    summary: "Enregistrer les actions et messages de l’app",
    description:
      "Lot de 1 à 50 événements. Identifiant stable par événement : renvoyer un lot après une coupure ne crée pas de doublons. Le serveur impose origin=client et le propriétaire authentifié ; le client ne peut pas fabriquer une trace serveur.",
    effect: "write",
    example: uploadExample,
  }),
  request: {
    params: conversationParam("UUID de la conversation"),
    body: jsonBody(journalUploadBody, uploadExample),
  },
  responses: {
    ...commonErrors(),
    200: jsonResponse(recordedBody, "Réponse réussie"),
  },
});
const turnRoute = createRoute({
  method: "get",
  path: "/turns/{turnId}",
  ...operation({
    operationId: "getDjTurn",
    tag: TAG,
    summary: "Inspecter un tour et ses appels",
    description:
      "Entrée validée, contexte, décision, réponse finale et tours du fournisseur avec noms, arguments, résultats et durées des outils. Les champs historiques de la ligne SQL utilisent snake_case. Les clés configurées, en-têtes d’authentification et signatures internes du fournisseur ne sont pas collectés.",
  }),
  request: { params: turnParam },
  responses: {
    ...commonErrors(),
    200: jsonResponse(turnDetailBody, "Réponse réussie"),
    404: errorResponse("Tour inconnu pour ce compte"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/conversations/{conversationId}",
  ...operation({
    operationId: "deleteDjConversation",
    tag: TAG,
    summary: "Effacer une conversation et ses traces",
    description:
      "Effacement définitif de cette conversation du compte uniquement. Ne touche ni aux playlists, ni à l’historique d’écoute, ni à la clé Gemini. Les sauvegardes suivent leur propre rétention.",
    effect: "write",
  }),
  request: { params: conversationParam("UUID de la conversation à effacer") },
  responses: {
    ...commonErrors(),
    200: jsonResponse(deletedBody, "Réponse réussie"),
    404: unknownConversation,
  },
});

/** One more row than the page tells whether a next page exists. */
function paged<T>(rows: T[], limit: number, cursor: (last: T) => string) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, nextCursor: rows.length > limit && last ? cursor(last) : null };
}

/** The account's private DJ journal, under /v1/dj. */
export function journalRoutes(db: Database) {
  const app = featureRouter<ApiEnvironment>();
  app.openapi(conversationsRoute, async (c) => {
    const query = c.req.valid("query");
    const rows = await listConversations(db.orm, c.get("userId"), {
      before: query.before,
      limit: query.limit + 1,
    });
    const { page, nextCursor } = paged(rows, query.limit, (last) => last.id);
    return c.json(
      {
        conversations: page.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        nextCursor,
      },
      200,
    );
  });
  app.openapi(turnsRoute, async (c) => {
    const owner = c.get("userId");
    const { conversationId } = c.req.valid("param");
    const query = c.req.valid("query");
    if (!(await conversationExists(db.orm, owner, conversationId)))
      return c.json({ error: "Conversation inconnue." }, 404);
    const rows = await listTurns(db.orm, owner, conversationId, {
      before: query.before,
      limit: query.limit + 1,
    });
    const { page, nextCursor } = paged(rows, query.limit, (last) => last.id);
    return c.json(
      {
        turns: page.map((row) => ({
          ...row,
          startedAt: iso(row.startedAt),
          completedAt: isoOrNull(row.completedAt),
        })),
        nextCursor,
      },
      200,
    );
  });
  app.openapi(eventsRoute, async (c) => {
    const owner = c.get("userId");
    const { conversationId } = c.req.valid("param");
    const query = c.req.valid("query");
    if (!(await conversationExists(db.orm, owner, conversationId)))
      return c.json({ error: "Conversation inconnue." }, 404);
    const rows = await listEvents(db.orm, owner, conversationId, {
      after: query.after,
      limit: query.limit + 1,
    });
    const { page, nextCursor } = paged(rows, query.limit, (last) => last.sequence);
    return c.json(
      {
        events: page.map((row) => ({
          ...row,
          occurredAt: isoOrNull(row.occurredAt),
          receivedAt: iso(row.receivedAt),
        })),
        nextCursor,
      },
      200,
    );
  });
  app.openapi(uploadRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { events } = c.req.valid("json");
    return c.json(
      {
        recorded: await uploadJournalEvents(
          db,
          c.get("userId"),
          conversationId,
          events,
        ),
      },
      200,
    );
  });
  app.openapi(turnRoute, async (c) => {
    const found = await turnWithEvents(
      db.orm,
      c.get("userId"),
      c.req.valid("param").turnId,
    );
    if (!found) return c.json({ error: "Tour inconnu." }, 404);
    const { turn: t, events } = found;
    return c.json(
      {
        turn: {
          id: t.id,
          user_id: t.userId,
          conversation_id: t.conversationId,
          installation_id: t.installationId,
          request_id: t.requestId,
          scope: t.scope,
          requested_scope: t.requestedScope,
          trigger: t.trigger,
          status: t.status,
          input: t.input,
          plan: t.plan,
          response: t.response,
          model: t.model,
          prompt_hash: t.promptHash,
          release_sha: t.releaseSha,
          started_at: iso(t.startedAt),
          completed_at: isoOrNull(t.completedAt),
          journal_complete: t.journalComplete,
        },
        events: events.map((event) => ({
          ...event,
          receivedAt: iso(event.receivedAt),
        })),
      },
      200,
    );
  });
  app.openapi(deleteRoute, async (c) =>
    (await deleteConversation(
      db.orm,
      c.get("userId"),
      c.req.valid("param").conversationId,
    ))
      ? c.json({ deleted: true as const }, 200)
      : c.json({ error: "Conversation inconnue." }, 404),
  );
  return app;
}
