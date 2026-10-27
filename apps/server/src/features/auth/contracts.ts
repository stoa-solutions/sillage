import { z } from "@hono/zod-openapi";

/** PKCE values and the app's state: opaque base64url, never echoed into HTML unescaped. */
const opaqueValue = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
export const authStartInput = z
  .object({ challenge: opaqueValue, app_state: opaqueValue })
  .openapi("AuthStart");
export const authExchangeInput = z
  .object({ code: opaqueValue, verifier: opaqueValue })
  .openapi("AuthExchange");
export const authStatusBody = z.object({ google: z.boolean() });
export const sessionBody = z.object({
  token: z.string().openapi({
    description:
      "Secret de session : ne jamais journaliser, exporter ou committer.",
  }),
});
