import { LEGACY_USER } from "./accounts.ts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProvider,
} from "@playlist-recall/core/dj";
import { transaction, type Database } from "./db.ts";
import { djConfig, providerBaseUrl, type DjConfig } from "./dj-config.ts";

export const djSettingsInput = z
  .object({
    provider: z.enum(AI_PROVIDER_IDS).default("google"),
    apiKey: z.string().trim().min(20).max(256).optional(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9._:/-]+$/),
  })
  .refine(
    (value) =>
      value.model.startsWith(
        value.provider === "google" ? "gemini-" : "claude-",
      ),
    {
      message: "Le modèle ne correspond pas au fournisseur choisi.",
      path: ["model"],
    },
  );
export function settingsKey(): Buffer | null {
  const value = process.env.DJ_SETTINGS_ENCRYPTION_KEY;
  return value && /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : null;
}
export function sealSecret(secret: string, owner: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(owner));
  const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    bytes.toString("base64"),
  ].join(".");
}
export function openSecret(value: string, owner: string, key: Buffer): string {
  const [version, iv, tag, bytes, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !bytes || extra)
    throw new Error("Invalid encrypted credential");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(bytes, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
type Credential = {
  provider: AiProvider;
  model: string;
  encrypted_key: string;
};
async function credentials(db: Database, owner: string): Promise<Credential[]> {
  const result = await db.query<Credential>(
    `SELECT provider,model,encrypted_key FROM account_ai_credentials WHERE user_id=$1
     UNION ALL SELECT 'google',model,encrypted_key FROM account_dj_settings WHERE user_id=$1
       AND NOT EXISTS(SELECT 1 FROM account_ai_credentials WHERE user_id=$1 AND provider='google')`,
    [owner],
  );
  return result.rows;
}
export async function aiProviderStatus(db: Database, owner: string) {
  const rows = await credentials(db, owner);
  return AI_PROVIDERS.map((provider) => {
    const saved = rows.find((row) => row.provider === provider.id);
    return {
      ...provider,
      configured: Boolean(saved),
      model: saved?.model ?? provider.defaultModel,
    };
  });
}
export async function personalDjConfig(
  db: Database,
  owner: string,
  requested?: AiProvider,
): Promise<DjConfig & { personal: boolean }> {
  const preference = await db.query(
    "SELECT dj_provider FROM users WHERE id=$1",
    [owner],
  );
  const provider: AiProvider =
    requested ??
    (preference.rows[0]?.dj_provider === "anthropic" ? "anthropic" : "google");
  const saved = (await credentials(db, owner)).find(
    (row) => row.provider === provider,
  );
  if (!saved) {
    if (owner === LEGACY_USER && preference.rows[0]?.dj_provider === "legacy") {
      const legacy = djConfig();
      const legacyProvider =
        legacy.provider === "anthropic" ? "anthropic" : "google";
      if (!requested || requested === legacyProvider)
        return { ...legacy, personal: false };
    }
    return {
      provider,
      baseUrl: providerBaseUrl(provider),
      key: undefined,
      model: undefined,
      configured: false,
      personal: false,
    };
  }
  const encryption = settingsKey();
  if (!encryption) throw new Error("DJ settings encryption key unavailable");
  return {
    provider,
    baseUrl: providerBaseUrl(provider),
    model: saved.model,
    key: openSecret(saved.encrypted_key, owner, encryption),
    configured: true,
    personal: true,
  };
}
export async function saveDjSettings(
  db: Database,
  owner: string,
  input: z.infer<typeof djSettingsInput>,
) {
  const key = settingsKey();
  if (!key) return "unavailable" as const;
  return transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
    const existing = (
      await client.query<Credential>(
        `SELECT provider,model,encrypted_key FROM account_ai_credentials WHERE user_id=$1 AND provider=$2
       UNION ALL SELECT 'google',model,encrypted_key FROM account_dj_settings WHERE user_id=$1 AND $2='google'
         AND NOT EXISTS(SELECT 1 FROM account_ai_credentials WHERE user_id=$1 AND provider=$2)`,
        [owner, input.provider],
      )
    ).rows[0];
    const encrypted = input.apiKey
      ? sealSecret(input.apiKey, owner, key)
      : existing?.encrypted_key;
    if (!encrypted) return "missing-key" as const;
    await client.query(
      `INSERT INTO account_ai_credentials(user_id,provider,encrypted_key,model) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,model=EXCLUDED.model,updated_at=now()`,
      [owner, input.provider, encrypted, input.model],
    );
    if (input.provider === "google")
      await client.query(
        `INSERT INTO account_dj_settings(user_id,encrypted_key,model) VALUES($1,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,model=EXCLUDED.model,updated_at=now()`,
        [owner, encrypted, input.model],
      );
    await client.query("UPDATE users SET dj_provider=$2 WHERE id=$1", [
      owner,
      input.provider,
    ]);
    return "saved" as const;
  });
}
export async function resetDjSettings(
  db: Database,
  owner: string,
  provider?: AiProvider,
) {
  await transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
    await client.query(
      "DELETE FROM account_ai_credentials WHERE user_id=$1 AND ($2::text IS NULL OR provider=$2)",
      [owner, provider ?? null],
    );
    if (!provider || provider === "google")
      await client.query("DELETE FROM account_dj_settings WHERE user_id=$1", [
        owner,
      ]);
    if (!provider)
      await client.query("UPDATE users SET dj_provider='google' WHERE id=$1", [
        owner,
      ]);
  });
}
