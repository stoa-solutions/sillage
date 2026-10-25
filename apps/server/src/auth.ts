import { randomBytes, randomUUID, createHash } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { hash } from "./content.ts";
import { transaction, type Database } from "./db.ts";

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
const opaque = () => randomBytes(32).toString("base64url");
const safeValue = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}
export interface IdentityProvider {
  authorize(state: string, nonce: string): string;
  verify(code: string, nonce: string): Promise<GoogleIdentity>;
}
export function googleProvider(): IdentityProvider | undefined {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return;
  const origin = process.env.PUBLIC_URL ?? "https://recall.stoa.solutions";
  const client = new OAuth2Client(id, secret, origin + "/auth/google/callback");
  return {
    authorize: (state, nonce) =>
      client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        prompt: "select_account",
        access_type: "online",
      }),
    async verify(code, nonce) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error("Missing identity");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: id,
      });
      const payload = ticket.getPayload();
      if (
        !payload?.sub ||
        !payload.email ||
        !payload.email_verified ||
        payload.nonce !== nonce
      )
        throw new Error("Invalid identity");
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name ?? "",
      };
    },
  };
}
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
    const input = z
      .object({ challenge: safeValue, app_state: safeValue })
      .parse(c.req.query());
    const now = Math.floor(Date.now() / 60000);
    if (minute !== now) {
      minute = now;
      starts = 0;
    }
    if (++starts > 60)
      return c.json({ error: "Réessaie dans une minute." }, 429);
    await db.query("DELETE FROM oauth_flows WHERE expires_at<now()");
    await db.query("DELETE FROM oauth_grants WHERE expires_at<now()");
    const state = opaque(),
      cookie = opaque(),
      nonce = opaque();
    await db.query(
      `INSERT INTO oauth_flows(state_hash,cookie_hash,challenge,app_state,nonce,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [hash(state), hash(cookie), input.challenge, input.app_state, nonce],
    );
    setCookie(c, "__Host-recall-auth", cookie, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(provider.authorize(state, nonce));
  });
  app.get("/google/callback", async (c) => {
    const state = c.req.query("state"),
      code = c.req.query("code");
    const cookie = getCookie(c, "__Host-recall-auth");
    deleteCookie(c, "__Host-recall-auth", { secure: true, path: "/" });
    if (
      !provider ||
      !state ||
      !code ||
      !cookie ||
      state.length > 128 ||
      code.length > 4096
    )
      return c.text(
        "Connexion annulée. Retourne dans Recall pour réessayer.",
        400,
      );
    const { rows } = await db.query(
      `DELETE FROM oauth_flows WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *`,
      [hash(state), hash(cookie)],
    );
    if (!rows.length)
      return c.text("Cette connexion a expiré. Recommence depuis Recall.", 400);
    const flow = rows[0];
    try {
      const identity = await provider.verify(code, flow.nonce);
      const grant = opaque();
      await transaction(db, async (client) => {
        const user = await client.query(
          `INSERT INTO users(id,google_sub,email,name) VALUES($1,$2,$3,$4)
          ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name RETURNING id`,
          [randomUUID(), identity.sub, identity.email, identity.name],
        );
        await client.query(
          `INSERT INTO oauth_grants(code_hash,user_id,challenge,expires_at) VALUES($1,$2,$3,now()+interval '90 seconds')`,
          [hash(grant), user.rows[0].id, flow.challenge],
        );
      });
      return c.redirect(
        "playlist-recall://auth?" +
          new URLSearchParams({ code: grant, state: flow.app_state }),
      );
    } catch {
      return c.text(
        "Google n’a pas pu confirmer cette connexion. Réessaie depuis Recall.",
        400,
      );
    }
  });
  app.post("/exchange", async (c) => {
    const { code, verifier } = z
      .object({ code: safeValue, verifier: safeValue })
      .parse(await c.req.json());
    const token = opaque();
    const user = await transaction(db, async (client) => {
      const grant = await client.query(
        `DELETE FROM oauth_grants WHERE code_hash=$1 AND challenge=$2 AND expires_at>now() RETURNING user_id`,
        [hash(code), pkceChallenge(verifier)],
      );
      if (!grant.rowCount) return null;
      await client.query(
        `INSERT INTO tokens(id,name,hash,user_id,expires_at) VALUES($1,'Google Mac',$2,$3,now()+interval '90 days')`,
        [randomUUID(), hash(token), grant.rows[0].user_id],
      );
      return grant.rows[0].user_id;
    });
    if (!user)
      return c.json({ error: "Connexion expirée ou déjà utilisée." }, 401);
    return c.json({ token });
  });
  return app;
}
