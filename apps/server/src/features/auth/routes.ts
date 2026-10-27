import { randomBytes, createHash } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hash } from "../../content.ts";
import type { Database } from "../../db/index.ts";
import { authExchangeInput, authStartInput } from "./contracts.ts";
import { googleProvider, type IdentityProvider } from "./google.ts";
import { googleReturnPage } from "./return-page.ts";
import {
  FLOW_MINUTES,
  consumeFlow,
  exchangeGrant,
  grantSignIn,
  startFlow,
} from "./store.ts";

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
const opaque = () => randomBytes(32).toString("base64url");
const COOKIE = "__Host-recall-auth";
const STARTS_PER_MINUTE = 60;

/**
 * Google sign-in for the native app: browser flow with a CSRF cookie and a one-time state, then
 * a 90-second code that only the app's PKCE verifier can trade for a session.
 */
export function authRoutes(db: Database, provider = googleProvider()) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 8192 }));
  let minute = 0,
    starts = 0;
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.get("/status", (c) => c.json({ google: Boolean(provider) }));
  app.get("/google/start", async (c) => {
    if (!provider)
      return c.json(
        { error: "La connexion Google attend sa configuration serveur." },
        503,
      );
    const input = authStartInput.parse(c.req.query());
    const now = Math.floor(Date.now() / 60000);
    if (minute !== now) {
      minute = now;
      starts = 0;
    }
    if (++starts > STARTS_PER_MINUTE)
      return c.json({ error: "Réessaie dans une minute." }, 429);
    const state = opaque(),
      cookie = opaque(),
      nonce = opaque();
    await startFlow(db.orm, {
      stateHash: hash(state),
      cookieHash: hash(cookie),
      challenge: input.challenge,
      appState: input.app_state,
      nonce,
    });
    setCookie(c, COOKIE, cookie, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: FLOW_MINUTES * 60,
    });
    return c.redirect(provider.authorize(state, nonce));
  });
  app.get("/google/callback", async (c) => {
    const state = c.req.query("state"),
      code = c.req.query("code");
    const cookie = getCookie(c, COOKIE);
    deleteCookie(c, COOKIE, { secure: true, path: "/" });
    if (
      !provider ||
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
    const flow = await consumeFlow(db.orm, hash(state), hash(cookie));
    if (!flow)
      return c.text("Cette connexion a expiré. Recommence depuis Sillage.", 400);
    try {
      const identity = await provider.verify(code, flow.nonce);
      const grant = opaque();
      await grantSignIn(db.orm, identity, {
        codeHash: hash(grant),
        challenge: flow.challenge,
      });
      const nonce = opaque();
      c.header(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      return c.html(
        googleReturnPage(
          "playlist-recall://auth?" +
            new URLSearchParams({ code: grant, state: flow.appState }),
          nonce,
        ),
      );
    } catch {
      return c.text(
        "Google n’a pas pu confirmer cette connexion. Réessaie depuis Sillage.",
        400,
      );
    }
  });
  app.post("/exchange", async (c) => {
    const { code, verifier } = authExchangeInput.parse(await c.req.json());
    const token = opaque();
    const user = await exchangeGrant(
      db.orm,
      { codeHash: hash(code), challenge: pkceChallenge(verifier) },
      hash(token),
    );
    if (!user)
      return c.json({ error: "Connexion expirée ou déjà utilisée." }, 401);
    return c.json({ token });
  });
  return app;
}
