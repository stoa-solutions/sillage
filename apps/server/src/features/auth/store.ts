import { randomUUID } from "node:crypto";
import type { Prisma } from "../../db.ts";
import type { GoogleIdentity } from "./google.ts";

const minutes = (count: number) => new Date(Date.now() + count * 60_000);
export const FLOW_MINUTES = 10;
export const GRANT_SECONDS = 90;
export const SESSION_DAYS = 90;
/** A session is extended by use once fewer than this many days remain. */
export const RENEW_BELOW_DAYS = 60;
const days = (count: number) => minutes(count * 24 * 60);

export interface NewFlow {
  stateHash: string;
  cookieHash: string;
  challenge: string;
  appState: string;
  nonce: string;
}

/** Records a sign-in about to leave for Google, and sweeps expired flows and grants. */
export async function startFlow(prisma: Prisma, flow: NewFlow) {
  const now = new Date();
  await prisma.oAuthFlow.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.oAuthGrant.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.oAuthFlow.create({
    data: { ...flow, expiresAt: minutes(FLOW_MINUTES) },
  });
}

/** Single use, bound to the browser cookie: of two concurrent callbacks, one deletes the flow. */
export async function consumeFlow(
  prisma: Prisma,
  stateHash: string,
  cookieHash: string,
) {
  const flow = await prisma.oAuthFlow.findUnique({ where: { stateHash } });
  if (!flow) return null;
  const { count } = await prisma.oAuthFlow.deleteMany({
    where: { stateHash, cookieHash, expiresAt: { gt: new Date() } },
  });
  return count ? flow : null;
}

/** Creates or refreshes the account of a verified Google identity and its one-time code. */
export async function grantSignIn(
  prisma: Prisma,
  identity: GoogleIdentity,
  grant: { codeHash: string; challenge: string },
) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { googleSub: identity.sub },
      create: {
        id: randomUUID(),
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
      },
      update: { email: identity.email, name: identity.name },
      select: { id: true },
    });
    await tx.oAuthGrant.create({
      data: {
        ...grant,
        userId: user.id,
        expiresAt: minutes(GRANT_SECONDS / 60),
      },
    });
  });
}

/**
 * Trades a one-time code and its PKCE challenge for a new session. A wrong verifier leaves the
 * code in place; a used or expired one opens nothing.
 */
export async function exchangeGrant(
  prisma: Prisma,
  grant: { codeHash: string; challenge: string },
  sessionHash: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const found = await tx.oAuthGrant.findUnique({
      where: { codeHash: grant.codeHash },
      select: { userId: true },
    });
    if (!found) return null;
    const { count } = await tx.oAuthGrant.deleteMany({
      where: { ...grant, expiresAt: { gt: new Date() } },
    });
    if (!count) return null;
    await tx.sessionToken.create({
      data: {
        id: randomUUID(),
        name: "Google Mac",
        hash: sessionHash,
        userId: found.userId,
        expiresAt: days(SESSION_DAYS),
      },
    });
    return found.userId;
  });
}

/** The live session of a token hash: not revoked, not expired. */
export function activeSession(prisma: Prisma, hash: string) {
  return prisma.sessionToken.findFirst({
    where: {
      hash,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, userId: true },
  });
}

/** Sliding expiry: renewed when used with fewer than RENEW_BELOW_DAYS left. Personal tokens
 * without expiry stay without one. */
export async function extendSession(prisma: Prisma, id: string) {
  await prisma.sessionToken.updateMany({
    where: { id, expiresAt: { lt: days(RENEW_BELOW_DAYS) } },
    data: { expiresAt: days(SESSION_DAYS) },
  });
}

export async function revokeSession(prisma: Prisma, id: string) {
  return prisma.sessionToken.updateMany({
    where: { id },
    data: { revokedAt: new Date() },
  });
}
