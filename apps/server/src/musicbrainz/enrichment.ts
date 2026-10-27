import type { MusicMetadata } from "@playlist-recall/core/types";
import { hash } from "../content.ts";
import { ormOn, transaction, type Database } from "../db/index.ts";
import { enrichmentAccounts, enrichmentBatchSize } from "./rollout.ts";
import { enqueue, type ClaimedJob } from "../features/jobs/index.ts";
import { MusicBrainzClient } from "./client.ts";
import {
  chooseRecording,
  metadataFromRecording,
  sourceIdentity,
  unsupported,
  type Recording,
  type SourceTrack,
} from "./matching.ts";

/** Pilot IDs remain supported alongside explicit account rollouts. */
export function pilotIds(): string[] {
  return [
    ...new Set(
      (process.env["MUSICBRAINZ_PILOT_IDS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[\w-]{11}$/.test(s)),
    ),
  ].slice(0, 10);
}
const identity = (r: any): SourceTrack => ({
  title: r.title,
  channel: r.channel,
  durationSeconds: r.duration_seconds,
});
const fingerprint = (r: any) => hash(JSON.stringify(identity(r)));
// Both scheduling and execution re-check membership and account opt-in.
const eligible = `(v.id=ANY($1::text[]) OR EXISTS(
  SELECT 1 FROM memberships m JOIN user_playlists up ON up.playlist_id=m.playlist_id
  WHERE m.video_id=v.id AND m.active AND up.user_id=ANY($2::uuid[])))`;
export async function scheduleMusicEnrichment(db: Database) {
  const ids = pilotIds(),
    accounts = enrichmentAccounts();
  if (!ids.length && !accounts.length) return;
  await transaction(db, async (client) => {
    // Serialize concurrent schedulers so the shared queue remains bounded, including delayed retries.
    await client.query("SELECT pg_advisory_xact_lock(740074)");
    const pending = Number(
      (
        await client.query(
          "SELECT count(*) FROM jobs WHERE kind='musicbrainz' AND status IN ('pending','running')",
        )
      ).rows[0].count,
    );
    const capacity = Math.max(0, enrichmentBatchSize - pending);
    if (!capacity) return;
    const { rows } = await client.query(
      `SELECT v.* FROM videos v WHERE ${eligible} AND v.available AND v.enriched_at IS NOT NULL
      AND v.music_metadata IS NULL AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active)
      AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.kind='musicbrainz' AND j.payload->>'videoId'=v.id
        AND (j.status IN ('pending','running') OR (j.status='failed' AND j.completed_at>now()-interval '1 day')))
      ORDER BY v.id LIMIT $3`,
      [ids, accounts, capacity],
    );
    for (const row of rows)
      await enqueue(ormOn(client), "musicbrainz", `${row.id}:${fingerprint(row)}`, {
        videoId: row.id,
      });
  });
}
export async function enrichMusic(
  db: Database,
  job: ClaimedJob,
  provider = new MusicBrainzClient(db),
) {
  const id = job.payload["videoId"]!;
  const row = (
    await db.query(
      `SELECT v.* FROM videos v WHERE ${eligible} AND v.id=$3 AND v.available AND v.enriched_at IS NOT NULL
       AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active)`,
      [pilotIds(), enrichmentAccounts(), id],
    )
  ).rows[0];
  if (!row || row.music_metadata) return;
  const source = identity(row),
    checkedAt = new Date().toISOString();
  let metadata: MusicMetadata = {
    source: "MusicBrainz",
    status: "not_found",
    checkedAt,
    artists: [],
    albums: [],
    genres: [],
    artistGenres: [],
    searchText: "",
  };
  if (unsupported(source))
    metadata.reason =
      "Version spéciale ou instrumental : aucune attribution automatique.";
  else {
    const query = sourceIdentity(source);
    // Escape Lucene syntax inside quoted user-controlled catalog fields.
    const quote = (s: string) => '"' + s.replace(/[\\"]/g, "\\$&") + '"';
    const result = await provider.get<{ recordings: Recording[] }>(
      "recording/",
      {
        query: `recording:${quote(query.title)} AND artist:${quote(query.artist.split(/\s+(?:x|&|and)\s+/i)[0] ?? query.artist)}`,
        limit: "25",
      },
    );
    if (!Array.isArray(result.recordings))
      throw new Error("Réponse MusicBrainz invalide. Réessai différé.");
    const match = chooseRecording(source, result.recordings);
    if (match.status === "matched") {
      const recording = await provider.get<Recording>(
        `recording/${match.recording.id}`,
        { inc: "artist-credits+releases+release-groups+genres" },
      );
      if (
        recording.id !== match.recording.id ||
        chooseRecording(source, [recording]).status !== "matched"
      )
        throw new Error("La fiche MusicBrainz a changé. Réessai différé.");
      const primary = recording["artist-credit"]?.[0]?.artist;
      const artist = primary
        ? await provider.get<{ genres?: { name: string; count?: number }[] }>(
            `artist/${primary.id}`,
            { inc: "genres" },
          )
        : null;
      metadata = metadataFromRecording(
        recording,
        match.score,
        checkedAt,
        (artist?.genres ?? [])
          .filter((g) => (g.count ?? 1) > 0)
          .map((g) => g.name)
          .slice(0, 12),
      );
    } else {
      metadata.status = match.status;
      metadata.confidence = match.score;
      metadata.reason =
        match.status === "ambiguous"
          ? "Plusieurs versions possibles ou preuves insuffisantes : rien attribué."
          : "Aucune correspondance MusicBrainz suffisamment précise.";
    }
  }
  // A stale worker or changed YouTube identity cannot publish a superseded match.
  const updated = await db.query(
    `UPDATE videos SET music_metadata=$2 WHERE id=$1 AND music_metadata IS NULL
    AND title IS NOT DISTINCT FROM $3 AND channel IS NOT DISTINCT FROM $4 AND duration_seconds IS NOT DISTINCT FROM $5
    AND EXISTS(SELECT 1 FROM jobs WHERE id=$6 AND lease_id=$7 AND status='running' AND lease_until>now()) RETURNING content_hash`,
    [
      id,
      JSON.stringify(metadata),
      source.title,
      source.channel,
      source.durationSeconds,
      job.id,
      job.leaseId,
    ],
  );
  if (updated.rowCount && metadata.status === "matched")
    await enqueue(db.orm, "text", `${id}:${updated.rows[0].content_hash}`, {
      videoId: id,
    });
}
