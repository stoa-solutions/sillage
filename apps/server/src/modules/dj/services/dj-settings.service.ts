import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProvider,
} from "@sillage/core/dj";
import type { Database } from "../../../db/index.ts";
import {
  deleteCredentials,
  preferredProvider,
  saveCredential,
  storedCredentials,
} from "../repositories/dj-settings.repository.ts";
import { providerBaseUrl, type DjConfig } from "../dj.config.ts";

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
  const value = process.env["DJ_SETTINGS_ENCRYPTION_KEY"];
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
export async function aiProviderStatus(db: Database, owner: string) {
  const rows = await storedCredentials(db.orm, owner);
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
  const preference = await preferredProvider(db.orm, owner);
  const provider: AiProvider =
    requested ?? (preference === "anthropic" ? "anthropic" : "google");
  const saved = (await storedCredentials(db.orm, owner)).find(
    (row) => row.provider === provider,
  );
  if (!saved)
    return {
      provider,
      baseUrl: providerBaseUrl(provider),
      key: undefined,
      model: undefined,
      configured: false,
      personal: false,
    };
  const encryption = settingsKey();
  if (!encryption) throw new Error("DJ settings encryption key unavailable");
  return {
    provider,
    baseUrl: providerBaseUrl(provider),
    model: saved.model,
    key: openSecret(saved.encryptedKey, owner, encryption),
    configured: true,
    personal: true,
  };
}
/** Saves a key and model; the first configuration of a provider needs its key. */
export async function saveDjSettings(
  db: Database,
  owner: string,
  input: z.infer<typeof djSettingsInput>,
) {
  const key = settingsKey();
  if (!key) return "unavailable" as const;
  const saved = await saveCredential(
    db.orm,
    owner,
    input.provider,
    input.model,
    (existing) =>
      input.apiKey ? sealSecret(input.apiKey, owner, key) : existing,
  );
  return saved ? ("saved" as const) : ("missing-key" as const);
}
/** Deletes one provider's key, or every key of the account. */
export async function resetDjSettings(
  db: Database,
  owner: string,
  provider?: AiProvider,
) {
  await deleteCredentials(db.orm, owner, provider);
}
