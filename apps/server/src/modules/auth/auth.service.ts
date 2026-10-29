import { createHash, randomBytes } from "node:crypto";
import { hash } from "../../shared/content.ts";
import type { Database } from "../../db/index.ts";
import {
  consumeFlow,
  exchangeGrant,
  grantSignIn,
  startFlow,
} from "./auth.repository.ts";
import type { IdentityProvider } from "./google.provider.ts";

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
const opaque = () => randomBytes(32).toString("base64url");

/**
 * Google sign-in for the native app, without HTTP: the controller turns these results into
 * cookies, redirects and pages. Only hashes of the state, cookie, code and session are stored.
 */
export function authService(db: Database, provider: IdentityProvider) {
  return {
    /** Opens a 10-minute flow bound to a browser cookie; returns where to send the browser. */
    async begin(input: { challenge: string; appState: string }) {
      const state = opaque(),
        cookie = opaque(),
        nonce = opaque();
      await startFlow(db.orm, {
        stateHash: hash(state),
        cookieHash: hash(cookie),
        challenge: input.challenge,
        appState: input.appState,
        nonce,
      });
      return { cookie, redirect: provider.authorize(state, nonce) };
    },

    /**
     * Google's return: consumes the flow once, verifies the identity and issues a 90-second
     * code for the app. `expired` and `rejected` are answered differently to the browser.
     */
    async complete(state: string, code: string, cookie: string) {
      const flow = await consumeFlow(db.orm, hash(state), hash(cookie));
      if (!flow) return { outcome: "expired" as const };
      try {
        const identity = await provider.verify(code, flow.nonce);
        const grant = opaque();
        await grantSignIn(db.orm, identity, {
          codeHash: hash(grant),
          challenge: flow.challenge,
        });
        return {
          outcome: "signed-in" as const,
          appUrl:
            "sillage://auth?" +
            new URLSearchParams({ code: grant, state: flow.appState }),
        };
      } catch {
        return { outcome: "rejected" as const };
      }
    },

    /** Trades the app's code and PKCE verifier for a session token, or null. */
    async exchange(code: string, verifier: string) {
      const token = opaque();
      const user = await exchangeGrant(
        db.orm,
        { codeHash: hash(code), challenge: pkceChallenge(verifier) },
        hash(token),
      );
      return user ? token : null;
    },
  };
}
