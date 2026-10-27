/** The library from before accounts existed; one Google account can take it over once. */
export const LEGACY_USER = "00000000-0000-4000-8000-000000000001";

/**
 * Ownership filter for the features still written in SQL: true when the account follows the
 * playlist. SQL aliases are static source code, never request input. Removed once every
 * library query goes through Prisma.
 */
export const ownsPlaylist = (alias: string, parameter: string) =>
  `EXISTS(SELECT 1 FROM user_playlists up WHERE up.playlist_id=${alias} AND up.user_id=${parameter})`;
