import type { Prisma } from "../../db.ts";
import { LEGACY_USER } from "./legacy.ts";

export interface AccountProfile {
  id: string;
  email: string | null;
  name: string | null;
  /** A Google account, as opposed to the historical library. */
  google: boolean;
}

export async function accountProfile(
  prisma: Prisma,
  userId: string,
): Promise<AccountProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, googleSub: true },
  });
  return user && {
    id: user.id,
    email: user.email,
    name: user.name,
    google: user.googleSub !== null,
  };
}

class ClaimRefused extends Error {}

/**
 * Moves the historical library to a Google account, once: playlists, listening history and the
 * old tokens. Requires a live historical token as proof of ownership. All or nothing.
 */
export async function claimLegacyLibrary(
  prisma: Prisma,
  userId: string,
  legacyTokenHash: string,
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const google = await tx.user.count({
        where: { id: userId, googleSub: { not: null } },
      });
      if (!google) return false;
      // Taking the claim locks the historical row: a concurrent claim waits, then finds it taken.
      const claim = await tx.user.updateMany({
        where: { id: LEGACY_USER, legacyClaimedBy: null },
        data: { legacyClaimedBy: userId },
      });
      if (!claim.count) return false;
      const proof = await tx.sessionToken.count({
        where: {
          hash: legacyTokenHash,
          userId: LEGACY_USER,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (!proof) throw new ClaimRefused();
      const playlists = await tx.userPlaylist.findMany({
        where: { userId: LEGACY_USER },
        select: { playlistId: true },
      });
      await tx.userPlaylist.createMany({
        data: playlists.map(({ playlistId }) => ({ userId, playlistId })),
        skipDuplicates: true,
      });
      await tx.userPlaylist.deleteMany({ where: { userId: LEGACY_USER } });
      await tx.listeningEvent.updateMany({
        where: { userId: LEGACY_USER },
        data: { userId },
      });
      await tx.sessionToken.updateMany({
        where: { userId: LEGACY_USER },
        data: { userId },
      });
      return true;
    });
  } catch (error) {
    if (error instanceof ClaimRefused) return false;
    throw error;
  }
}
