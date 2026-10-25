import { LEGACY_USER } from "./accounts.ts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { DJ_MODELS } from "@playlist-recall/core/dj";
import type { Database } from "./db.ts";
import { djConfig, type DjConfig } from "./dj-config.ts";

const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
export const djSettingsInput = z.object({
  apiKey: z.string().trim().min(20).max(256).optional(),
  model: z.enum(DJ_MODELS),
});
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
export async function personalDjConfig(
  db: Database,
  owner: string,
): Promise<DjConfig & { personal: boolean }> {
  const { rows } = await db.query(
    "SELECT encrypted_key,model FROM account_dj_settings WHERE user_id=$1",
    [owner],
  );
  if (!rows.length)
    return {
      ...djConfig(),
      ...(owner === LEGACY_USER ? {} : { key: undefined, configured: false }),
      personal: false,
    };
  const key = settingsKey();
  if (!key) throw new Error("DJ settings encryption key unavailable");
  return {
    baseUrl: geminiUrl,
    model: rows[0].model,
    key: openSecret(rows[0].encrypted_key, owner, key),
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
  if (!input.apiKey) {
    const result = await db.query(
      "UPDATE account_dj_settings SET model=$2,updated_at=now() WHERE user_id=$1 RETURNING user_id",
      [owner, input.model],
    );
    return result.rowCount ? ("saved" as const) : ("missing-key" as const);
  }
  const encrypted = sealSecret(input.apiKey, owner, key);
  await db.query(
    `INSERT INTO account_dj_settings(user_id,encrypted_key,model) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,model=EXCLUDED.model,updated_at=now()`,
    [owner, encrypted, input.model],
  );
  return "saved" as const;
}
