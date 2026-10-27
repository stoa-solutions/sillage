import { randomUUID } from "node:crypto";
import type { Database } from "./db/index.ts";
import type { PoolClient } from "pg";
export interface Job {
  id: string;
  kind: "sync" | "enrich" | "text" | "image" | "musicbrainz";
  payload: Record<string, string>;
  attempts: number;
  lease_id: string;
}
export async function enqueue(
  db: Database | PoolClient,
  kind: Job["kind"],
  key: string,
  payload: Record<string, string>,
) {
  const { rows } = await db.query(
    `INSERT INTO jobs(id,kind,dedupe_key,payload) VALUES($1,$2,$3,$4)
    ON CONFLICT(dedupe_key) WHERE status IN ('pending','running') DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id,status`,
    [randomUUID(), kind, `${kind}:${key}`, payload],
  );
  return rows[0];
}
export async function claim(
  db: Database,
  youtubeConfigured = true,
): Promise<Job | undefined> {
  // Recover a killed process without allowing its late result to finish a new lease.
  const { rows } = await db.query(
    `WITH next AS (
    SELECT id FROM jobs WHERE ((status='pending' AND available_at<=now()) OR (status='running' AND lease_until<now()))
    AND ($2::boolean OR kind NOT IN ('sync','enrich'))
    ORDER BY CASE kind WHEN 'sync' THEN 0 WHEN 'enrich' THEN 1 WHEN 'text' THEN 2 ELSE 3 END, created_at
    FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE jobs SET status='running', attempts=attempts+1, lease_until=now()+interval '5 minutes', lease_id=$1
    WHERE id=(SELECT id FROM next) RETURNING *`,
    [randomUUID(), youtubeConfigured],
  );
  return rows[0];
}
export async function finish(db: Database, job: Job, error?: Error) {
  const failed = Boolean(error) && job.attempts >= 5;
  await db.query(
    `UPDATE jobs SET status=$3,error=$4,lease_until=NULL,
    available_at=now()+($5*interval '1 second'),completed_at=CASE WHEN $3 IN ('done','failed') THEN now() ELSE NULL END
    WHERE id=$1 AND lease_id=$2 AND status='running'`,
    [
      job.id,
      job.lease_id,
      error ? (failed ? "failed" : "pending") : "done",
      error?.message.slice(0, 300) ?? null,
      Math.min(21600, 30 * 2 ** job.attempts),
    ],
  );
}
export async function schedule(db: Database) {
  if (process.env["SYNC_ENABLED"] !== "true") return;
  const { rows } = await db.query(
    // A playlist every account removed is no longer synchronised (quota and worker time).
    `SELECT p.id FROM playlists p WHERE p.sync_enabled AND p.next_sync_at<=now() AND EXISTS(SELECT 1 FROM user_playlists up WHERE up.playlist_id=p.id)`,
  );
  for (const row of rows) {
    await enqueue(db, "sync", row.id, { playlistId: row.id });
    await db.query(
      `UPDATE playlists SET next_sync_at=now()+interval '6 hours' WHERE id=$1`,
      [row.id],
    );
  }
}
