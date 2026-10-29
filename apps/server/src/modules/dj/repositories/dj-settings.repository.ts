import { and, eq } from "drizzle-orm";
import type { AiProvider } from "@sillage/core/dj";
import { accountAiCredentials, users, type Executor } from "../../../db/index.ts";

export interface StoredCredential {
  provider: AiProvider;
  model: string;
  encryptedKey: string;
}

/** The account's saved keys, one per provider. */
export function storedCredentials(
  db: Executor,
  owner: string,
  provider?: AiProvider,
): Promise<StoredCredential[]> {
  return db
    .select({
      provider: accountAiCredentials.provider,
      model: accountAiCredentials.model,
      encryptedKey: accountAiCredentials.encryptedKey,
    })
    .from(accountAiCredentials)
    .where(
      and(
        eq(accountAiCredentials.userId, owner),
        provider ? eq(accountAiCredentials.provider, provider) : undefined,
      ),
    );
}

export async function preferredProvider(db: Executor, owner: string) {
  const [user] = await db
    .select({ djProvider: users.djProvider })
    .from(users)
    .where(eq(users.id, owner));
  return user?.djProvider ?? null;
}

/**
 * Saves a provider's key and model, and makes it the account's provider. `seal` receives the
 * key already stored, if any: a model change keeps it. Concurrent saves of one account are
 * serialised on its row.
 */
export async function saveCredential(
  db: Executor,
  owner: string,
  provider: AiProvider,
  model: string,
  seal: (existing: string | undefined) => string | undefined,
) {
  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, owner)).for("update");
    const [existing] = await storedCredentials(tx, owner, provider);
    const encryptedKey = seal(existing?.encryptedKey);
    if (!encryptedKey) return false;
    await tx
      .insert(accountAiCredentials)
      .values({ userId: owner, provider, encryptedKey, model })
      .onConflictDoUpdate({
        target: [accountAiCredentials.userId, accountAiCredentials.provider],
        set: { encryptedKey, model, updatedAt: new Date() },
      });
    await tx.update(users).set({ djProvider: provider }).where(eq(users.id, owner));
    return true;
  });
}

/** Deletes one provider's key, or all of them and the provider choice. */
export async function deleteCredentials(
  db: Executor,
  owner: string,
  provider?: AiProvider,
) {
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, owner)).for("update");
    await tx
      .delete(accountAiCredentials)
      .where(
        and(
          eq(accountAiCredentials.userId, owner),
          provider ? eq(accountAiCredentials.provider, provider) : undefined,
        ),
      );
    if (!provider)
      await tx.update(users).set({ djProvider: "google" }).where(eq(users.id, owner));
  });
}
