import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sealSecret, openSecret } from "../src/modules/dj/services/dj-settings.service.ts";
it("encrypts credentials with random nonces and authenticates the installation and ciphertext", () => {
  const key = randomBytes(32);
  const secret = "fixture-key-never-use-in-production";
  const encrypted = sealSecret(secret, "installation-a", key);
  expect(encrypted).not.toContain(secret);
  expect(sealSecret(secret, "installation-a", key)).not.toBe(encrypted);
  expect(openSecret(encrypted, "installation-a", key)).toBe(secret);
  expect(() => openSecret(encrypted, "installation-b", key)).toThrow();
  expect(() =>
    openSecret(encrypted, "installation-a", randomBytes(32)),
  ).toThrow();
  const parts = encrypted.split(".");
  parts[3] = Buffer.from("modified ciphertext").toString("base64");
  expect(() => openSecret(parts.join("."), "installation-a", key)).toThrow();
});
