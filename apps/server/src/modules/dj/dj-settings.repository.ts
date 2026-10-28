import { and, eq } from "drizzle-orm";
import type { AiProvider } from "@sillage/core/dj";
import {
  accountAiCredentials,
  accountDjSettings,
  users,
  type Executor,
} from "../../db/index.ts";

export interface StoredCredential {
  provider: AiProvider;
  model: string;
  encryptedKey: string;
}

/**
 * The account's saved keys, one per provider. A Google key saved before multi-provider
 * settings is still read from account_dj_settings when no newer Google key exists.
 */
export async function storedCredentials(
  db: Executor,
  owner: string,
  provider?: AiProvider,
): Promise<StoredCredential[]> {
  const saved = await db
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
  if (saved.some((row) => row.provider === "google") || (provider && provider !== "google"))
    return saved;
  const legacy = await db
    .select({
      model: accountDjSettings.model,
      encryptedKey: accountDjSettings.encryptedKey,
    })
    .from(accountDjSettings)
    .where(eq(accountDjSettings.userId, owner));
  return [
    ...saved,
    ...legacy.map((row) => ({ provider: "google" as const, ...row })),
  ];
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
 * key already stored, if any: a model change keeps it. The Google key is mirrored for older
 * servers. Concurrent saves of one account are serialised on its row.
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
    if (provider === "google")
      await tx
        .insert(accountDjSettings)
        .values({ userId: owner, encryptedKey, model })
        .onConflictDoUpdate({
          target: accountDjSettings.userId,
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
    if (!provider || provider === "google")
      await tx.delete(accountDjSettings).where(eq(accountDjSettings.userId, owner));
    if (!provider)
      await tx.update(users).set({ djProvider: "google" }).where(eq(users.id, owner));
  });
}
