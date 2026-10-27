import { z } from "zod";

/** PKCE values and the app's state: opaque base64url, never echoed into HTML unescaped. */
const opaqueValue = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
export const authStartInput = z.object({
  challenge: opaqueValue,
  app_state: opaqueValue,
});
export const authExchangeInput = z.object({
  code: opaqueValue,
  verifier: opaqueValue,
});
