import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  LEGACY_USER_ID,
  listeningHistory,
  tokens,
  userPlaylists,
  users,
  type Orm,
} from "../../db/index.ts";

export interface AccountProfile {
  id: string;
  email: string | null;
  name: string | null;
  /** A Google account, as opposed to the historical library. */
  google: boolean;
}

export async function accountProfile(
  orm: Orm,
  userId: string,
): Promise<AccountProfile | null> {
  const [profile] = await orm
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      google: sql<boolean>`${users.googleSub} IS NOT NULL`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return profile ?? null;
}

/**
 * Moves the historical library to a Google account, once: playlists, listening history and the
 * old tokens. `proven` tells whether the caller holds a live historical token. All or nothing.
 */
export async function claimLegacyLibrary(
  orm: Orm,
  userId: string,
  proven: (orm: Orm) => Promise<boolean>,
): Promise<boolean> {
  return orm.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.googleSub)));
    if (!target) return false;
    // The row lock makes a second, concurrent claim wait, then see the library taken.
    const [legacy] = await tx
      .select({ claimedBy: users.legacyClaimedBy })
      .from(users)
      .where(eq(users.id, LEGACY_USER_ID))
      .for("update");
    if (!legacy || legacy.claimedBy || !(await proven(tx))) return false;
    const owned = await tx
      .select({ playlistId: userPlaylists.playlistId })
      .from(userPlaylists)
      .where(eq(userPlaylists.userId, LEGACY_USER_ID));
    if (owned.length)
      await tx
        .insert(userPlaylists)
        .values(owned.map(({ playlistId }) => ({ userId, playlistId })))
        .onConflictDoNothing();
    await tx
      .delete(userPlaylists)
      .where(eq(userPlaylists.userId, LEGACY_USER_ID));
    await tx
      .update(listeningHistory)
      .set({ userId })
      .where(eq(listeningHistory.userId, LEGACY_USER_ID));
    await tx
      .update(tokens)
      .set({ userId })
      .where(eq(tokens.userId, LEGACY_USER_ID));
    await tx
      .update(users)
      .set({ legacyClaimedBy: userId })
      .where(eq(users.id, LEGACY_USER_ID));
    return true;
  });
}
