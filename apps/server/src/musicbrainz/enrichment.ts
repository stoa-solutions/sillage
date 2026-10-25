import type { MusicMetadata } from "@playlist-recall/core/types";
import { hash } from "../content.ts";
import type { Database } from "../db.ts";
import { enqueue, type Job } from "../queue.ts";
import { MusicBrainzClient } from "./client.ts";
import {
  chooseRecording,
  metadataFromRecording,
  sourceIdentity,
  unsupported,
  type Recording,
  type SourceTrack,
} from "./matching.ts";

/** No global enable switch in this pilot. Only these explicitly configured video IDs are eligible. */
export function pilotIds(): string[] {
  return [
    ...new Set(
      (process.env.MUSICBRAINZ_PILOT_IDS ?? "")
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
export async function scheduleMusicEnrichment(db: Database) {
  const ids = pilotIds();
  if (!ids.length) return;
  const { rows } = await db.query(
    `SELECT v.* FROM videos v WHERE v.id=ANY($1) AND v.available AND v.enriched_at IS NOT NULL
    AND v.music_metadata IS NULL AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active)
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.kind='musicbrainz' AND j.payload->>'videoId'=v.id AND j.status='failed' AND j.completed_at>now()-interval '1 day')`,
    [ids],
  );
  for (const row of rows)
    await enqueue(db, "musicbrainz", `${row.id}:${fingerprint(row)}`, {
      videoId: row.id,
    });
}
export async function enrichMusic(
  db: Database,
  job: Job,
  provider = new MusicBrainzClient(db),
) {
  const id = job.payload.videoId!;
  if (!pilotIds().includes(id)) return;
  const row = (
    await db.query(
      "SELECT * FROM videos WHERE id=$1 AND available AND enriched_at IS NOT NULL",
      [id],
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
        query: `recording:${quote(query.title)} AND artist:${quote(query.artist.split(/\s+(?:x|&|and)\s+/i)[0])}`,
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
      job.lease_id,
    ],
  );
  if (updated.rowCount && metadata.status === "matched")
    await enqueue(db, "text", `${id}:${updated.rows[0].content_hash}`, {
      videoId: id,
    });
}
