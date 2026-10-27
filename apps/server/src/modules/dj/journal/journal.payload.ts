import { createHash } from "node:crypto";

/** Preserve conversation content verbatim. Credentials are never passed to this module. */
export function journalPayload(value: unknown): unknown {
  try {
    const text = JSON.stringify(value ?? null);
    return Buffer.byteLength(text) <= 262144
      ? JSON.parse(text)
      : {
          truncated: true,
          bytes: Buffer.byteLength(text),
          sha256: createHash("sha256").update(text).digest("hex"),
          preview: text.slice(0, 8192),
        };
  } catch {
    return { omitted: true, reason: "unserializable" };
  }
}
