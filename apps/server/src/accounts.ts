import type { Database } from "./db.ts";
export const LEGACY_USER = "00000000-0000-4000-8000-000000000001";
// SQL aliases are static source code, never request input.
export const ownsPlaylist = (alias: string, parameter: string) =>
  `EXISTS(SELECT 1 FROM user_playlists up WHERE up.playlist_id=${alias} AND up.user_id=${parameter})`;
export async function accountProfile(db: Database, userId: string) {
  const { rows } = await db.query(
    "SELECT id,email,name,google_sub IS NOT NULL AS google FROM users WHERE id=$1",
    [userId],
  );
  return rows[0];
}
