import { createRoute } from "@hono/zod-openapi";
import { randomBytes } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Database } from "../../../db/index.ts";
import {
  commonErrors,
  errorResponse,
  featureRouter,
  jsonResponse,
  operation,
  textResponse,
} from "../../../shared/openapi.ts";
import {
  authExchangeInput,
  authStartInput,
  authStatusBody,
  sessionBody,
} from "../types/auth.schemas.ts";
import { googleProvider, type IdentityProvider } from "../google.provider.ts";
import { googleReturnPage } from "../return-page.ts";
import { FLOW_MINUTES } from "../repositories/auth.repository.ts";
import { authService } from "../services/auth.service.ts";

const COOKIE = "__Host-sillage-auth";
const STARTS_PER_MINUTE = 60;
const TAG = "Connexion Google";

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  ...operation({
    operationId: "getAuthStatus",
    tag: TAG,
    summary: "Disponibilité de Google",
    description:
      "Indique si la connexion Google est configurée, sans exposer d’identifiant privé.",
    public: true,
  }),
  responses: {
    ...commonErrors(true),
    200: jsonResponse(authStatusBody, "Réponse réussie") },
});

const startRoute = createRoute({
  method: "get",
  path: "/google/start",
  ...operation({
    operationId: "startGoogleSignIn",
    tag: TAG,
    summary: "Commencer la connexion",
    effect: "browser",
    description:
      "À ouvrir dans le navigateur système. Le Mac crée un verifier PKCE et app_state, puis envoie SHA-256(verifier) en base64url comme challenge. Le serveur pose un cookie Secure HttpOnly SameSite=Lax et redirige vers Google. Flux valable 10 minutes. Scopes : openid, email, profile ; aucun accès aux playlists YouTube.",
    public: true,
  }),
  request: { query: authStartInput },
  responses: {
    ...commonErrors(true),
    302: {
      description: "Redirection Google",
      headers: {
        Location: { schema: { type: "string" } },
        "Set-Cookie": {
          schema: { type: "string" },
          description:
            "__Host-sillage-auth ; Secure ; HttpOnly ; SameSite=Lax ; Path=/",
        },
      },
    },
    429: errorResponse("Plus de 60 démarrages par minute"),
    503: errorResponse("Google non configuré"),
  },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/google/callback",
  ...operation({
    operationId: "completeGoogleSignIn",
    tag: TAG,
    summary: "Retour du navigateur Google",
    effect: "browser",
    description:
      "Google fournit code et state ; le cookie du démarrage est obligatoire. Vérification de l’identité et du nonce, puis retour HTML vers sillage://auth?code=…&state=…. Le code de retour Sillage est à usage unique, valable 90 secondes et lié au challenge PKCE. Il ne s’agit ni d’une clé Google ni du jeton API. Ne pas rejouer manuellement le callback hors du flux navigateur.",
    public: true,
  }),
  security: [{ googleFlowCookie: [] }],
  // Checked by the handler, which answers in text for the browser rather than JSON.
  parameters: [
    {
      name: "state",
      in: "query",
      required: true,
      schema: { type: "string", maxLength: 128 },
    },
    {
      name: "code",
      in: "query",
      required: true,
      schema: { type: "string", maxLength: 4096 },
    },
  ],
  responses: {
    ...commonErrors(true),
    200: textResponse("text/html", "Page de retour vers l’app Mac"),
    400: textResponse(
      "text/plain",
      "Connexion annulée, expirée ou identité non confirmée",
    ),
  },
});

const exchangeRoute = createRoute({
  method: "post",
  path: "/exchange",
  ...operation({
    operationId: "exchangeSignInGrant",
    tag: TAG,
    summary: "Échanger le code contre une session",
    effect: "write",
    description:
      "L’app échange le code Sillage reçu par son lien de retour et son verifier PKCE. Usage unique. Le jeton retourné est conservé dans le fichier privé de session du Mac ; le serveur conserve son empreinte. Validité 90 jours, prolongée à l’usage lorsque moins de 60 jours restent.",
    public: true,
    example: { code: "{{auth_code}}", verifier: "{{pkce_verifier}}" },
  }),
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: authExchangeInput,
          example: { code: "{{auth_code}}", verifier: "{{pkce_verifier}}" },
        },
      },
    },
  },
  responses: {
    ...commonErrors(true),
    200: jsonResponse(sessionBody, "Réponse réussie"),
    401: errorResponse("Code expiré, réutilisé ou verifier incorrect"),
    413: textResponse("text/plain", "Corps supérieur à 8 Kio"),
  },
});

/**
 * Google sign-in for the native app: browser flow with a CSRF cookie and a one-time state, then
 * a 90-second code that only the app's PKCE verifier can trade for a session.
 */
export function authRoutes(db: Database, provider = googleProvider()) {
  const app = featureRouter();
  const service = provider && authService(db, provider);
  app.use("*", bodyLimit({ maxSize: 8192 }));
  let minute = 0,
    starts = 0;
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.openapi(statusRoute, (c) => c.json({ google: Boolean(provider) }, 200));
  app.openapi(startRoute, async (c) => {
    if (!service)
      return c.json(
        { error: "La connexion Google attend sa configuration serveur." },
        503,
      );
    const input = c.req.valid("query");
    const now = Math.floor(Date.now() / 60000);
    if (minute !== now) {
      minute = now;
      starts = 0;
    }
    if (++starts > STARTS_PER_MINUTE)
      return c.json({ error: "Réessaie dans une minute." }, 429);
    const { cookie, redirect } = await service.begin({
      challenge: input.challenge,
      appState: input.app_state,
    });
    setCookie(c, COOKIE, cookie, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: FLOW_MINUTES * 60,
    });
    return c.redirect(redirect, 302);
  });
  app.openapi(callbackRoute, async (c) => {
    const state = c.req.query("state"),
      code = c.req.query("code");
    const cookie = getCookie(c, COOKIE);
    deleteCookie(c, COOKIE, { secure: true, path: "/" });
    if (
      !service ||
      !state ||
      !code ||
      !cookie ||
      state.length > 128 ||
      code.length > 4096
    )
      return c.text(
        "Connexion annulée. Retourne dans Sillage pour réessayer.",
        400,
      );
    const result = await service.complete(state, code, cookie);
    if (result.outcome === "expired")
      return c.text("Cette connexion a expiré. Recommence depuis Sillage.", 400);
    if (result.outcome === "rejected")
      return c.text(
        "Google n’a pas pu confirmer cette connexion. Réessaie depuis Sillage.",
        400,
      );
    const nonce = randomBytes(32).toString("base64url");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    return c.html(googleReturnPage(result.appUrl, nonce), 200);
  });
  app.openapi(exchangeRoute, async (c) => {
    const { code, verifier } = c.req.valid("json");
    const token = service && (await service.exchange(code, verifier));
    if (!token)
      return c.json({ error: "Connexion expirée ou déjà utilisée." }, 401);
    return c.json({ token }, 200);
  });
  return app;
}
