import type { Database } from "../db.ts";
import { ownsPlaylist } from "../accounts.ts";

/** Explicit account opt-in; never enables the public catalog globally. */
export function enrichmentAccounts(): string[] {
  return [
    ...new Set(
      (process.env.MUSICBRAINZ_ACCOUNT_IDS ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) =>
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id),
        ),
    ),
  ];
}
export const enrichmentBatchSize = 10;

export async function enrichmentProgress(db: Database, userId: string) {
  const { rows } = await db.query(
    `WITH owned AS (
    SELECT v.* FROM videos v WHERE EXISTS (
      SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active
      AND ${ownsPlaylist("m.playlist_id", "$1")})
  ), state AS (
    SELECT v.*, j.status AS job_status, j.attempts FROM owned v
    LEFT JOIN LATERAL (SELECT status,attempts FROM jobs
      WHERE kind='musicbrainz' AND payload->>'videoId'=v.id
      ORDER BY created_at DESC,id DESC LIMIT 1) j ON v.music_metadata IS NULL
  ) SELECT count(*)::int AS total,
    count(*) FILTER(WHERE music_metadata IS NOT NULL)::int AS processed,
    count(*) FILTER(WHERE music_metadata->>'status'='matched')::int AS matched,
    count(*) FILTER(WHERE music_metadata->>'status'='ambiguous')::int AS ambiguous,
    count(*) FILTER(WHERE music_metadata->>'status'='not_found')::int AS not_found,
    count(*) FILTER(WHERE music_metadata IS NULL AND NOT available)::int AS unavailable,
    count(*) FILTER(WHERE music_metadata IS NULL AND available AND enriched_at IS NULL)::int AS awaiting_youtube,
    count(*) FILTER(WHERE music_metadata IS NULL AND available AND job_status='pending')::int AS queued,
    count(*) FILTER(WHERE music_metadata IS NULL AND available AND job_status='running')::int AS running,
    count(*) FILTER(WHERE music_metadata IS NULL AND available AND job_status='pending' AND attempts>0)::int AS retrying,
    count(*) FILTER(WHERE music_metadata IS NULL AND available AND job_status='failed')::int AS failed
    FROM state`,
    [userId],
  );
  return {
    ...rows[0],
    enabled: enrichmentAccounts().includes(userId),
    batchSize: enrichmentBatchSize,
    checkedAt: new Date().toISOString(),
  };
}
