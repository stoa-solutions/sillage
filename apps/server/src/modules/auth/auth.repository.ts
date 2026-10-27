import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { oauthFlows, oauthGrants, tokens, users, type Orm } from "../../db/index.ts";
import type { GoogleIdentity } from "./google.provider.ts";

export const FLOW_MINUTES = 10;
export const GRANT_SECONDS = 90;
export const SESSION_DAYS = 90;
/** A session is extended by use once fewer than this many days remain. */
export const RENEW_BELOW_DAYS = 60;
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000);
const inDays = (days: number) => inSeconds(days * 24 * 3600);

/** Not revoked, and either without expiry (personal tokens) or not yet expired. */
const live = () =>
  and(
    isNull(tokens.revokedAt),
    or(isNull(tokens.expiresAt), gt(tokens.expiresAt, new Date())),
  );

export interface NewFlow {
  stateHash: string;
  cookieHash: string;
  challenge: string;
  appState: string;
  nonce: string;
}

/** Records a sign-in about to leave for Google, and sweeps expired flows and grants. */
export async function startFlow(orm: Orm, flow: NewFlow) {
  const now = new Date();
  await orm.delete(oauthFlows).where(lt(oauthFlows.expiresAt, now));
  await orm.delete(oauthGrants).where(lt(oauthGrants.expiresAt, now));
  await orm
    .insert(oauthFlows)
    .values({ ...flow, expiresAt: inSeconds(FLOW_MINUTES * 60) });
}

/** Single use, bound to the browser cookie: of two concurrent callbacks, one gets the flow. */
export async function consumeFlow(
  orm: Orm,
  stateHash: string,
  cookieHash: string,
) {
  const [flow] = await orm
    .delete(oauthFlows)
    .where(
      and(
        eq(oauthFlows.stateHash, stateHash),
        eq(oauthFlows.cookieHash, cookieHash),
        gt(oauthFlows.expiresAt, new Date()),
      ),
    )
    .returning();
  return flow ?? null;
}

/** Creates or refreshes the account of a verified Google identity, with its one-time code. */
export async function grantSignIn(
  orm: Orm,
  identity: GoogleIdentity,
  grant: { codeHash: string; challenge: string },
) {
  await orm.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        id: randomUUID(),
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { email: identity.email, name: identity.name },
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Account upsert returned nothing");
    await tx.insert(oauthGrants).values({
      ...grant,
      userId: user.id,
      expiresAt: inSeconds(GRANT_SECONDS),
    });
  });
}

/**
 * Trades a one-time code and its PKCE challenge for a new session. A wrong verifier leaves the
 * code in place; a used or expired code opens nothing.
 */
export async function exchangeGrant(
  orm: Orm,
  grant: { codeHash: string; challenge: string },
  sessionHash: string,
): Promise<string | null> {
  return orm.transaction(async (tx) => {
    const [used] = await tx
      .delete(oauthGrants)
      .where(
        and(
          eq(oauthGrants.codeHash, grant.codeHash),
          eq(oauthGrants.challenge, grant.challenge),
          gt(oauthGrants.expiresAt, new Date()),
        ),
      )
      .returning({ userId: oauthGrants.userId });
    if (!used) return null;
    await tx.insert(tokens).values({
      id: randomUUID(),
      name: "Google Mac",
      hash: sessionHash,
      userId: used.userId,
      expiresAt: inDays(SESSION_DAYS),
    });
    return used.userId;
  });
}

/** The live session of a token hash. */
export async function activeSession(orm: Orm, hash: string) {
  const [session] = await orm
    .select({ id: tokens.id, userId: tokens.userId })
    .from(tokens)
    .where(and(eq(tokens.hash, hash), live()));
  return session ?? null;
}

/** Sliding expiry: renewed when used with fewer than RENEW_BELOW_DAYS left. Tokens without
 * expiry keep none (NULL never compares lower). */
export async function extendSession(orm: Orm, id: string) {
  await orm
    .update(tokens)
    .set({ expiresAt: inDays(SESSION_DAYS) })
    .where(
      and(eq(tokens.id, id), lt(tokens.expiresAt, inDays(RENEW_BELOW_DAYS))),
    );
}

export async function revokeSession(orm: Orm, id: string) {
  const revoked = await orm
    .update(tokens)
    .set({ revokedAt: new Date() })
    .where(eq(tokens.id, id))
    .returning({ id: tokens.id });
  return revoked.length;
}

/** True when the hash belongs to a live token of that account. */
export async function holdsLiveToken(orm: Orm, userId: string, hash: string) {
  const [found] = await orm
    .select({ id: tokens.id })
    .from(tokens)
    .where(and(eq(tokens.hash, hash), eq(tokens.userId, userId), live()));
  return Boolean(found);
}
