import type { MusicMetadata } from "@playlist-recall/core/types";
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { hash } from "../../content.ts";
import {
  jobs,
  memberships,
  userPlaylists,
  videos,
  type Database,
  type Executor,
} from "../../db/index.ts";
import { MusicBrainzClient } from "../../integrations/musicbrainz/index.ts";
import { enqueue, holdsLease, type ClaimedJob } from "../jobs/index.ts";
import { enrichmentAccounts, enrichmentBatchSize } from "./progress.ts";
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
type VideoRow = typeof videos.$inferSelect;
const identity = (r: VideoRow): SourceTrack => ({
  // Eligible videos are enriched by YouTube, which always gives a title.
  title: r.title ?? "",
  channel: r.channel,
  durationSeconds: r.durationSeconds,
});
const fingerprint = (r: VideoRow) => hash(JSON.stringify(identity(r)));

/** Active in some playlist. */
const inAnyPlaylist = (db: Executor) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(memberships)
      .where(and(eq(memberships.videoId, videos.id), eq(memberships.active, true))),
  );
/**
 * A pilot video, or one in the library of an account that opted in. Both scheduling and
 * execution re-check it, so revoking an account stops its pending work.
 */
function eligible(db: Executor) {
  const ids = pilotIds(),
    accounts = enrichmentAccounts();
  // Nobody opted in: nothing is eligible (an empty OR would select everything).
  if (!ids.length && !accounts.length) return sql`false`;
  return or(
    ids.length ? inArray(videos.id, ids) : undefined,
    accounts.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(memberships)
            .innerJoin(
              userPlaylists,
              eq(userPlaylists.playlistId, memberships.playlistId),
            )
            .where(
              and(
                eq(memberships.videoId, videos.id),
                eq(memberships.active, true),
                inArray(userPlaylists.userId, accounts),
              ),
            ),
        )
      : undefined,
  );
}

/** Queues at most enrichmentBatchSize MusicBrainz jobs at a time for eligible, undecided videos. */
export async function scheduleMusicEnrichment(db: Database) {
  if (!pilotIds().length && !enrichmentAccounts().length) return;
  await db.orm.transaction(async (tx) => {
    // Serialize concurrent schedulers so the shared queue remains bounded, including delayed retries.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(740074)`);
    const [active] = await tx
      .select({ count: count() })
      .from(jobs)
      .where(
        and(eq(jobs.kind, "musicbrainz"), inArray(jobs.status, ["pending", "running"])),
      );
    const capacity = Math.max(0, enrichmentBatchSize - (active?.count ?? 0));
    if (!capacity) return;
    const due = await tx
      .select()
      .from(videos)
      .where(
        and(
          eligible(tx),
          eq(videos.available, true),
          isNotNull(videos.enrichedAt),
          isNull(videos.musicMetadata),
          inAnyPlaylist(tx),
          // Not while a job runs or waits, nor within a day of a final failure.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(jobs)
              .where(
                and(
                  eq(jobs.kind, "musicbrainz"),
                  sql`${jobs.payload}->>'videoId' = ${videos.id}`,
                  or(
                    inArray(jobs.status, ["pending", "running"]),
                    and(
                      eq(jobs.status, "failed"),
                      gt(jobs.completedAt, sql`now() - interval '1 day'`),
                    ),
                  ),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(videos.id))
      .limit(capacity);
    for (const row of due)
      await enqueue(tx, "musicbrainz", `${row.id}:${fingerprint(row)}`, {
        videoId: row.id,
      });
  });
}
export async function enrichMusic(
  db: Database,
  job: ClaimedJob,
  provider = new MusicBrainzClient(db),
) {
  const id = job.payload["videoId"];
  if (!id) throw new Error("Tâche MusicBrainz sans vidéo.");
  const [row] = await db.orm
    .select()
    .from(videos)
    .where(
      and(
        eligible(db.orm),
        eq(videos.id, id),
        eq(videos.available, true),
        isNotNull(videos.enrichedAt),
        inAnyPlaylist(db.orm),
      ),
    );
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
  const updated = await db.orm.transaction(async (tx) => {
    if (!(await holdsLease(tx, job, { lock: true, unexpired: true }))) return [];
    return tx
      .update(videos)
      .set({ musicMetadata: metadata })
      .where(
        and(
          eq(videos.id, id),
          isNull(videos.musicMetadata),
          sql`${videos.title} IS NOT DISTINCT FROM ${row.title}`,
          sql`${videos.channel} IS NOT DISTINCT FROM ${row.channel}`,
          sql`${videos.durationSeconds} IS NOT DISTINCT FROM ${row.durationSeconds}::double precision`,
        ),
      )
      .returning({ contentHash: videos.contentHash });
  });
  const [published] = updated;
  if (published && metadata.status === "matched")
    await enqueue(db.orm, "text", `${id}:${published.contentHash}`, {
      videoId: id,
    });
}
