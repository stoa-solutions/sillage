import { Hono } from "hono";
import { z } from "zod";
import { transaction, type Database } from "./db.ts";
import { hash } from "./content.ts";
import { LEGACY_USER } from "./accounts.ts";
import type { ApiEnvironment } from "./dj-routes.ts";
export function accountRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.post("/claim-library", async (c) => {
    const { legacyToken } = z
      .object({ legacyToken: z.string().min(20).max(256) })
      .parse(await c.req.json());
    const user = c.get("userId");
    const claimed = await transaction(db, async (client) => {
      const target = await client.query(
        "SELECT 1 FROM users WHERE id=$1 AND google_sub IS NOT NULL",
        [user],
      );
      if (!target.rowCount) return false;
      const legacy = await client.query(
        "SELECT legacy_claimed_by FROM users WHERE id=$1 FOR UPDATE",
        [LEGACY_USER],
      );
      if (legacy.rows[0].legacy_claimed_by) return false;
      const proof = await client.query(
        `SELECT 1 FROM tokens WHERE hash=$1 AND user_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,
        [hash(legacyToken), LEGACY_USER],
      );
      if (!proof.rowCount) return false;
      await client.query(
        `INSERT INTO user_playlists(user_id,playlist_id) SELECT $1,playlist_id FROM user_playlists WHERE user_id=$2 ON CONFLICT DO NOTHING`,
        [user, LEGACY_USER],
      );
      await client.query("DELETE FROM user_playlists WHERE user_id=$1", [
        LEGACY_USER,
      ]);
      await client.query(
        "UPDATE listening_history SET user_id=$1 WHERE user_id=$2",
        [user, LEGACY_USER],
      );
      await client.query("UPDATE tokens SET user_id=$1 WHERE user_id=$2", [
        user,
        LEGACY_USER,
      ]);
      await client.query("UPDATE users SET legacy_claimed_by=$1 WHERE id=$2", [
        user,
        LEGACY_USER,
      ]);
      return true;
    });
    return claimed
      ? c.json({ saved: true })
      : c.json(
          { error: "Bibliothèque déjà transférée ou preuve invalide." },
          403,
        );
  });
  return app;
}
