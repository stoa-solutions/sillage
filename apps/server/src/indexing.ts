import { MODEL_KEY } from "@playlist-recall/core/model";
import { hash, documentText, vectorSql } from "./content.ts";
import { transaction, type Database } from "./db/index.ts";
import { videoFromRow } from "./library.ts";
import { infer } from "./inference-client.ts";
export const TEXT_KEY = `${MODEL_KEY}:chunks-v2`;
export const VISION_ID = "onnx-community/siglip2-base-patch16-224-ONNX";
export const VISION_REVISION = "ba1f3b0843f24bc5417d38e19c37b287d719b2f4";
export const VISION_KEY = `${VISION_ID}@${VISION_REVISION}:q8:l2:v1`;
export async function indexText(db: Database, id: string) {
  const row = (await db.query("SELECT * FROM videos WHERE id=$1", [id]))
    .rows[0];
  if (!row?.title) return;
  if (
    row.content_hash === row.index_hash &&
    (
      await db.query(
        "SELECT 1 FROM passages WHERE video_id=$1 AND model_key=$2 LIMIT 1",
        [id, TEXT_KEY],
      )
    ).rowCount
  )
    return;
  const text = documentText(videoFromRow(row));
  const result = await infer<{ texts: string[]; vectors: number[][] }>(
    "passages",
    { text },
  );
  if (!result.texts.length || result.texts.length !== result.vectors.length)
    throw new Error("Index textuel incomplet.");
  await transaction(db, async (client) => {
    const check = await client.query(
      `SELECT id FROM videos WHERE id=$1 AND content_hash=$2 FOR UPDATE`,
      [id, row.content_hash],
    );
    if (!check.rowCount) return;
    await client.query("DELETE FROM passages WHERE video_id=$1", [id]);
    for (let i = 0; i < result.texts.length; i++)
      await client.query(
        `INSERT INTO passages(video_id,ordinal,text,source_hash,model_key,embedding) VALUES($1,$2,$3,$4,$5,$6::vector)`,
        [
          id,
          i,
          result.texts[i],
          row.content_hash,
          TEXT_KEY,
          vectorSql(result.vectors[i]!, 384),
        ],
      );
    await client.query("UPDATE videos SET index_hash=$2 WHERE id=$1", [
      id,
      row.content_hash,
    ]);
  });
}
export class ThumbnailUnavailable extends Error {}

export async function fetchThumbnail(
  url: string,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["i.ytimg.com", "i9.ytimg.com"].includes(parsed.hostname) ||
    parsed.port
  )
    throw new Error("Hôte de miniature interdit.");
  const response = await request(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404 || response.status === 410)
    throw new ThumbnailUnavailable("Miniature indisponible sur YouTube.");
  if (!response.ok) throw new Error(`Miniature HTTP ${response.status}`);
  if (
    !/^image\/(jpeg|png|webp)(;|$)/.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error("Type de miniature invalide.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Miniature vide.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024)
        throw new Error("Miniature trop volumineuse.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw new Error("Miniature vide.");
  return Buffer.concat(parts);
}
export async function indexImage(db: Database, id: string) {
  if (process.env.VISION_ENABLED !== "true") return;
  const row = (await db.query("SELECT * FROM videos WHERE id=$1", [id]))
    .rows[0];
  if (!row?.available) return;
  try {
    const bytes = await fetchThumbnail(row.thumbnail_url);
    const digest = hash(bytes);
    const old = await db.query(
      "SELECT 1 FROM images WHERE video_id=$1 AND source_hash=$2 AND model_key=$3 AND source_url=$4",
      [id, digest, VISION_KEY, row.thumbnail_url],
    );
    if (!old.rowCount) {
      const { vector } = await infer<{ vector: number[] }>("image", {
        base64: Buffer.from(bytes).toString("base64"),
      });
      await db.query(
        `INSERT INTO images(video_id,source_hash,model_key,embedding,source_url)
        SELECT $1,$2,$3,$4::vector,$5 WHERE EXISTS(SELECT 1 FROM videos WHERE id=$1 AND thumbnail_url=$5)
        ON CONFLICT(video_id) DO UPDATE SET source_hash=excluded.source_hash,source_url=excluded.source_url,model_key=excluded.model_key,embedding=excluded.embedding,indexed_at=now()`,
        [id, digest, VISION_KEY, vectorSql(vector, 768), row.thumbnail_url],
      );
    }
    await db.query(
      `UPDATE videos SET image_hash=$2,image_checked_at=now(),image_error=NULL WHERE id=$1 AND thumbnail_url=$3`,
      [id, digest, row.thumbnail_url],
    );
  } catch (error) {
    if (error instanceof ThumbnailUnavailable) {
      await db.query(
        `UPDATE videos SET image_error=$2,image_checked_at=now() WHERE id=$1 AND thumbnail_url=$3`,
        [id, error.message, row.thumbnail_url],
      );
      return;
    }
    await db.query(`UPDATE videos SET image_error=$2 WHERE id=$1`, [
      id,
      error instanceof Error ? error.message : "Image indisponible",
    ]);
    throw error;
  }
}
