import { OAuth2Client } from "google-auth-library";

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}
/** The identity provider seam: Google in production, a fake in tests. */
export interface IdentityProvider {
  authorize(state: string, nonce: string): string;
  verify(code: string, nonce: string): Promise<GoogleIdentity>;
}

/** Google OpenID Connect with openid, email and profile only; undefined until configured. */
export function googleProvider(): IdentityProvider | undefined {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return;
  const origin = process.env.PUBLIC_URL ?? "https://recall.stoa.solutions";
  const client = new OAuth2Client(id, secret, origin + "/auth/google/callback");
  return {
    authorize: (state, nonce) =>
      client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        prompt: "select_account",
        access_type: "online",
      }),
    async verify(code, nonce) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error("Missing identity");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: id,
      });
      const payload = ticket.getPayload();
      if (
        !payload?.sub ||
        !payload.email ||
        !payload.email_verified ||
        payload.nonce !== nonce
      )
        throw new Error("Invalid identity");
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name ?? "",
      };
    },
  };
}
