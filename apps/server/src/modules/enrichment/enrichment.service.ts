import type { MusicMetadata } from "@sillage/core/types";
import { hash } from "../../content.ts";
import type { Database, videos } from "../../db/index.ts";
import { MusicBrainzClient } from "../../integrations/musicbrainz/index.ts";
import { enqueue, type ClaimedJob } from "../jobs/index.ts";
import {
  enrichmentAccounts,
  enrichmentBatchSize,
  pilotIds,
} from "./enrichment.config.ts";
import {
  eligibleVideo,
  enrichmentProgress,
  publishMetadata,
  queueEnrichmentBatch,
} from "./enrichment.repository.ts";
import {
  chooseRecording,
  metadataFromRecording,
  sourceIdentity,
  unsupported,
  type Recording,
  type SourceTrack,
} from "./enrichment.matching.ts";

type VideoRow = typeof videos.$inferSelect;
const identity = (r: VideoRow): SourceTrack => ({
  // Eligible videos are enriched by YouTube, which always gives a title.
  title: r.title ?? "",
  channel: r.channel,
  durationSeconds: r.durationSeconds,
});
const fingerprint = (r: VideoRow) => hash(JSON.stringify(identity(r)));

/** Queues the next bounded batch of MusicBrainz jobs, when some account or pilot opted in. */
export async function scheduleMusicEnrichment(db: Database) {
  if (!pilotIds().length && !enrichmentAccounts().length) return;
  await queueEnrichmentBatch(db.orm, (row) => `${row.id}:${fingerprint(row)}`);
}

/** Progress of the account's library, with whether its rollout is enabled. */
export async function enrichmentProgressFor(db: Database, userId: string) {
  return {
    ...(await enrichmentProgress(db.orm, userId)),
    enabled: enrichmentAccounts().includes(userId),
    batchSize: enrichmentBatchSize,
    checkedAt: new Date().toISOString(),
  };
}

export async function enrichMusic(
  db: Database,
  job: ClaimedJob,
  provider = new MusicBrainzClient(db),
) {
  const id = job.payload["videoId"];
  if (!id) throw new Error("Tâche MusicBrainz sans vidéo.");
  const row = await eligibleVideo(db.orm, id);
  if (!row || row.musicMetadata) return;
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
  const published = await publishMetadata(db.orm, job, row, metadata);
  if (published && metadata.status === "matched")
    await enqueue(db.orm, "text", `${id}:${published.contentHash}`, {
      videoId: id,
    });
}
