import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Video, LibraryImport } from "@playlist-recall/core/types";
import { documentText, hash } from "./content.ts";
import { transaction, type Database } from "./db.ts";
import { enqueue, type Job } from "./queue.ts";
import { TEXT_KEY, VISION_KEY } from "./indexing.ts";
import { YouTube } from "./youtube.ts";

export async function upsertVideo(
  client: pg.PoolClient | Database,
  v: Video,
  enriched = false,
) {
  await client.query(
    `INSERT INTO videos(id,title,channel,duration_seconds,description,tags,published_at,thumbnail_url,content_hash,enriched_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10 THEN now() ELSE NULL END)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,channel=excluded.channel,duration_seconds=excluded.duration_seconds,
    description=excluded.description,tags=excluded.tags,published_at=excluded.published_at,thumbnail_url=excluded.thumbnail_url,
    content_hash=excluded.content_hash,enriched_at=CASE WHEN $10 THEN now() ELSE videos.enriched_at END,available=true`,
    [
      v.id,
      v.title,
      v.channel,
      v.durationSeconds,
      v.description,
      JSON.stringify(v.tags),
      v.publishedAt,
      v.thumbnailUrl,
      hash(documentText(v)),
      enriched,
    ],
  );
}
export function videoFromRow(row: any): Video {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    durationSeconds: row.duration_seconds,
    description: row.description,
    tags: row.tags,
    publishedAt: row.published_at,
    thumbnailUrl: row.thumbnail_url,
    url: `https://www.youtube.com/watch?v=${row.id}`,
  };
}
export async function importLibrary(db: Database, library: LibraryImport) {
  await transaction(db, async (client) => {
    for (const p of library.playlists)
      await client.query(
        `INSERT INTO playlists(id,title,source_url) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
        [p.id, p.title, p.sourceUrl],
      );
    for (const v of library.videos) {
      const existing = await client.query(
        "SELECT id FROM videos WHERE id=$1 AND enriched_at IS NOT NULL",
        [v.id],
      );
      if (!existing.rowCount) await upsertVideo(client, v);
    }
    for (const m of library.memberships)
      await client.query(
        `INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation)
      SELECT $1,$2,$3,$4,0 WHERE (SELECT generation FROM playlists WHERE id=$2)=0 ON CONFLICT(key) DO NOTHING`,
        [`seed:${m.key}`, m.playlistId, m.videoId, m.position],
      );
  });
  await enqueueMissing(db);
}
export async function enqueueMissing(db: Database) {
  const { rows } = await db.query(
    `SELECT v.id,v.content_hash,v.index_hash,v.title,v.image_checked_at,v.image_hash,i.source_hash,i.model_key AS image_model,EXISTS(SELECT 1 FROM passages p WHERE p.video_id=v.id AND p.model_key=$1) AS text_current
    FROM videos v LEFT JOIN images i ON i.video_id=v.id WHERE v.available AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active)`,
    [TEXT_KEY],
  );
  for (const v of rows) {
    if (v.title && (v.content_hash !== v.index_hash || !v.text_current))
      await enqueue(db, "text", `${v.id}:${v.content_hash}`, { videoId: v.id });
    if (
      process.env.VISION_ENABLED === "true" &&
      (!v.image_checked_at ||
        v.image_model !== VISION_KEY ||
        Date.now() - new Date(v.image_checked_at).getTime() > 86400000)
    )
      await enqueue(db, "image", v.id, { videoId: v.id });
  }
}
export async function syncPlaylist(db: Database, youtube: YouTube, job: Job) {
  const id = job.payload.playlistId!;
  const runId = randomUUID();
  await db.query(`INSERT INTO sync_runs(id,playlist_id) VALUES($1,$2)`, [
    runId,
    id,
  ]);
  await db.query(
    `UPDATE playlists SET status='syncing',error=NULL WHERE id=$1`,
    [id],
  );
  try {
    const snapshot = await youtube.playlist(id);
    await transaction(db, async (client) => {
      const lease = await client.query(
        `SELECT id FROM jobs WHERE id=$1 AND lease_id=$2 AND status='running' FOR UPDATE`,
        [job.id, job.lease_id],
      );
      if (!lease.rowCount)
        throw new Error(
          "Synchronisation remplacée par une nouvelle tentative.",
        );
      const { rows } = await client.query(
        `UPDATE playlists SET title=$2,generation=generation+1 WHERE id=$1 RETURNING generation`,
        [id, snapshot.title],
      );
      const generation = Number(rows[0].generation);
      if (generation === 1) {
        // The old export has no YouTube item IDs. Match occurrences, not positions:
        // newly added videos can shift every position in an existing playlist.
        const counts = new Map<string, number>();
        for (const entry of snapshot.entries)
          counts.set(entry.videoId, (counts.get(entry.videoId) ?? 0) + 1);
        await client.query(
          `WITH imported AS (
          SELECT key,video_id,row_number() OVER(PARTITION BY video_id ORDER BY position,key) AS occurrence
          FROM memberships WHERE playlist_id=$1 AND key LIKE 'seed:%'
        ), current AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(video_id text,occurrences integer))
        DELETE FROM memberships WHERE key IN (SELECT imported.key FROM imported JOIN current USING(video_id) WHERE imported.occurrence<=current.occurrences)`,
          [
            id,
            JSON.stringify(
              [...counts].map(([video_id, occurrences]) => ({
                video_id,
                occurrences,
              })),
            ),
          ],
        );
      }
      for (const entry of snapshot.entries) {
        const placeholder: Video = {
          id: entry.videoId,
          title: entry.title,
          channel: entry.channel,
          durationSeconds: null,
          description: "",
          tags: [],
          publishedAt: null,
          thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${entry.videoId}`,
        };
        await client.query(
          `INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
          [
            placeholder.id,
            placeholder.title,
            placeholder.channel,
            placeholder.thumbnailUrl,
            hash(documentText(placeholder)),
          ],
        );
        await client.query(
          `INSERT INTO memberships(key,playlist_id,video_id,position,added_at,seen_generation) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(key) DO UPDATE SET position=excluded.position,added_at=excluded.added_at,seen_generation=excluded.seen_generation,missing_count=0,active=true`,
          [
            entry.key,
            id,
            entry.videoId,
            entry.position,
            entry.addedAt,
            generation,
          ],
        );
      }
      await client.query(
        `UPDATE memberships SET missing_count=missing_count+1,active=(missing_count+1<2) WHERE playlist_id=$1 AND seen_generation<>$2`,
        [id, generation],
      );
      await client.query(
        `UPDATE playlists SET status='ready',error=NULL,last_sync_at=now(),next_sync_at=now()+interval '6 hours' WHERE id=$1`,
        [id],
      );
      await client.query(
        `UPDATE sync_runs SET status='done',entries=$2,finished_at=now() WHERE id=$1`,
        [runId, snapshot.entries.length],
      );
    });
    const { rows } = await db.query(
      `SELECT DISTINCT v.id FROM videos v JOIN memberships m ON m.video_id=v.id WHERE m.playlist_id=$1 AND m.active
      AND (v.enriched_at IS NULL OR v.enriched_at<now()-interval '1 day') ORDER BY v.id`,
      [id],
    );
    for (let i = 0; i < rows.length; i += 50) {
      const ids = rows
        .slice(i, i + 50)
        .map((r) => r.id)
        .join(",");
      await enqueue(db, "enrich", hash(ids), { ids });
    }
    await enqueueMissing(db);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur de synchronisation";
    await db.query(
      `UPDATE sync_runs SET status='error',error=$2,finished_at=now() WHERE id=$1`,
      [runId, message],
    );
    await db.query(`UPDATE playlists SET status='error',error=$2 WHERE id=$1`, [
      id,
      message,
    ]);
    throw error;
  }
}
export async function enrichVideos(
  db: Database,
  youtube: YouTube,
  ids: string[],
) {
  const videos = await youtube.videos(ids);
  const returned = new Set(videos.map((v) => v.id));
  await transaction(db, async (client) => {
    for (const v of videos) await upsertVideo(client, v, true);
    for (const id of ids)
      if (!returned.has(id))
        await client.query(
          `UPDATE videos SET available=false,enriched_at=now() WHERE id=$1`,
          [id],
        );
  });
  for (const v of videos) {
    await enqueue(db, "text", `${v.id}:${hash(documentText(v))}`, {
      videoId: v.id,
    });
    await enqueue(db, "image", v.id, { videoId: v.id });
  }
}
