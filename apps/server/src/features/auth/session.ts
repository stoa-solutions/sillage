import type { MiddlewareHandler } from "hono";
import { hash } from "../../content.ts";
import type { Database } from "../../db/index.ts";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import { activeSession, extendSession } from "./store.ts";

const REQUESTS_PER_MINUTE = 180;

/**
 * Bearer session for /v1: sets the account and installation of the request, limits each token
 * to REQUESTS_PER_MINUTE (per process) and keeps responses out of caches.
 */
export function sessionGuard(db: Database): MiddlewareHandler<ApiEnvironment> {
  const rate = new Map<string, { minute: number; count: number }>();
  return async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 512)
      return c.json({ error: "Connexion requise." }, 401);
    const tokenHash = hash(authorization.slice(7));
    const session = await activeSession(db.orm, tokenHash);
    if (!session)
      return c.json({ error: "Connexion expirée ou jeton invalide." }, 401);
    const minute = Math.floor(Date.now() / 60000);
    const state = rate.get(tokenHash);
    if (state?.minute === minute && state.count >= REQUESTS_PER_MINUTE)
      return c.json(
        { error: "Trop de demandes. Réessayez dans une minute." },
        429,
      );
    rate.set(tokenHash, {
      minute,
      count: state?.minute === minute ? state.count + 1 : 1,
    });
    if (rate.size > 1000)
      for (const [key, value] of rate)
        if (value.minute !== minute) rate.delete(key);
    c.header("Cache-Control", "no-store");
    c.set("installationId", session.id);
    c.set("userId", session.userId);
    await extendSession(db.orm, session.id);
    return next();
  };
}
