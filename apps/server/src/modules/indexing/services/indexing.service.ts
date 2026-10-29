import { documentText, hash } from "../../../shared/content.ts";
import type { Database } from "../../../db/index.ts";
import { infer } from "../../../integrations/inference/index.ts";
import {
  fetchThumbnail,
  ThumbnailUnavailable,
} from "../../../integrations/youtube/index.ts";
import { enqueue } from "../../jobs/index.ts";
import { videoFromRecord } from "../../library/index.ts";
import { TEXT_KEY, VISION_KEY } from "../indexing.constants.ts";
import {
  hasImage,
  hasPassages,
  indexStates,
  markImageChecked,
  markImageError,
  replacePassages,
  saveImage,
  videoById,
} from "../repositories/indexing.repository.ts";

const DAY = 86_400_000;

/** E5 passages of a video's text; skipped when already indexed for this text and model. */
export async function indexText(db: Database, id: string) {
  const video = await videoById(db.orm, id);
  if (!video?.title) return;
  if (
    video.contentHash === video.indexHash &&
    (await hasPassages(db.orm, id, TEXT_KEY))
  )
    return;
  const computed = await infer<{ texts: string[]; vectors: number[][] }>(
    "passages",
    { text: documentText(videoFromRecord(video)) },
  );
  if (!computed.texts.length || computed.texts.length !== computed.vectors.length)
    throw new Error("Index textuel incomplet.");
  await replacePassages(db.orm, video, TEXT_KEY, computed);
}

/**
 * SigLIP 2 embedding of the current thumbnail (VISION_ENABLED). A thumbnail YouTube no longer
 * serves is recorded as such; other failures are retried by the queue.
 */
export async function indexImage(db: Database, id: string) {
  if (process.env["VISION_ENABLED"] !== "true") return;
  const video = await videoById(db.orm, id);
  if (!video?.available) return;
  const sourceUrl = video.thumbnailUrl;
  try {
    const bytes = await fetchThumbnail(sourceUrl);
    const sourceHash = hash(bytes);
    const current = { sourceHash, modelKey: VISION_KEY, sourceUrl };
    if (!(await hasImage(db.orm, id, current))) {
      const { vector } = await infer<{ vector: number[] }>("image", {
        base64: Buffer.from(bytes).toString("base64"),
      });
      await saveImage(db.orm, id, { ...current, vector });
    }
    await markImageChecked(db.orm, id, sourceUrl, { imageHash: sourceHash });
  } catch (error) {
    if (error instanceof ThumbnailUnavailable) {
      await markImageChecked(db.orm, id, sourceUrl, { error: error.message });
      return;
    }
    await markImageError(
      db.orm,
      id,
      error instanceof Error ? error.message : "Image indisponible",
    );
    throw error;
  }
}

/** Queues text and image indexing for library videos whose index is missing or outdated. */
export async function enqueueMissing(db: Database) {
  for (const v of await indexStates(db.orm, TEXT_KEY)) {
    if (v.title && (v.contentHash !== v.indexHash || !v.textCurrent))
      await enqueue(db.orm, "text", `${v.id}:${v.contentHash}`, { videoId: v.id });
    if (
      process.env["VISION_ENABLED"] === "true" &&
      (!v.imageCheckedAt ||
        (!v.imageError && v.imageModel !== VISION_KEY) ||
        Date.now() - v.imageCheckedAt.getTime() > DAY)
    )
      await enqueue(db.orm, "image", v.id, { videoId: v.id });
  }
}
