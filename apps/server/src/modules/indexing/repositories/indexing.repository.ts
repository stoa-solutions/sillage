import { and, eq, exists, sql } from "drizzle-orm";
import { vectorSql } from "../../../shared/content.ts";
import {
  images,
  memberships,
  passages,
  videos,
  type Executor,
} from "../../../db/index.ts";

export async function videoById(db: Executor, id: string) {
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  return video ?? null;
}

export async function hasPassages(db: Executor, id: string, modelKey: string) {
  const rows = await db
    .select({ id: passages.videoId })
    .from(passages)
    .where(and(eq(passages.videoId, id), eq(passages.modelKey, modelKey)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Replaces the video's passages, unless its text changed while they were computed (the row
 * lock and hash check make a late result harmless).
 */
export async function replacePassages(
  db: Executor,
  video: { id: string; contentHash: string },
  modelKey: string,
  computed: { texts: string[]; vectors: number[][] },
) {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: videos.id })
      .from(videos)
      .where(and(eq(videos.id, video.id), eq(videos.contentHash, video.contentHash)))
      .for("update");
    if (!current) return;
    await tx.delete(passages).where(eq(passages.videoId, video.id));
    for (const [ordinal, text] of computed.texts.entries()) {
      const vector = computed.vectors[ordinal];
      if (!vector) throw new Error("Index textuel incomplet.");
      await tx.insert(passages).values({
        videoId: video.id,
        ordinal,
        text,
        sourceHash: video.contentHash,
        modelKey,
        embedding: sql`${vectorSql(vector, 384)}::vector`,
      });
    }
    await tx
      .update(videos)
      .set({ indexHash: video.contentHash })
      .where(eq(videos.id, video.id));
  });
}

export async function hasImage(
  db: Executor,
  id: string,
  current: { sourceHash: string; modelKey: string; sourceUrl: string },
) {
  const rows = await db
    .select({ id: images.videoId })
    .from(images)
    .where(
      and(
        eq(images.videoId, id),
        eq(images.sourceHash, current.sourceHash),
        eq(images.modelKey, current.modelKey),
        eq(images.sourceUrl, current.sourceUrl),
      ),
    );
  return rows.length > 0;
}

/** Stored only while the video still has this thumbnail URL. */
export async function saveImage(
  db: Executor,
  id: string,
  image: { sourceHash: string; modelKey: string; sourceUrl: string; vector: number[] },
) {
  const embedding = sql`${vectorSql(image.vector, 768)}::vector`;
  const [video] = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.thumbnailUrl, image.sourceUrl)));
  if (!video) return;
  await db
    .insert(images)
    .values({
      videoId: id,
      sourceHash: image.sourceHash,
      modelKey: image.modelKey,
      sourceUrl: image.sourceUrl,
      embedding,
    })
    .onConflictDoUpdate({
      target: images.videoId,
      set: {
        sourceHash: image.sourceHash,
        sourceUrl: image.sourceUrl,
        modelKey: image.modelKey,
        embedding,
        indexedAt: sql`now()`,
      },
    });
}

/** Records the outcome of a thumbnail check, for the thumbnail URL that was checked. */
export async function markImageChecked(
  db: Executor,
  id: string,
  thumbnailUrl: string,
  outcome: { imageHash: string } | { error: string },
) {
  await db
    .update(videos)
    .set(
      "imageHash" in outcome
        ? { imageHash: outcome.imageHash, imageCheckedAt: sql`now()`, imageError: null }
        : { imageError: outcome.error, imageCheckedAt: sql`now()` },
    )
    .where(and(eq(videos.id, id), eq(videos.thumbnailUrl, thumbnailUrl)));
}

/** A transient failure: noted, and retried by the queue. */
export async function markImageError(db: Executor, id: string, error: string) {
  await db.update(videos).set({ imageError: error }).where(eq(videos.id, id));
}

/** Available library videos with their index state, to find missing or outdated indexes. */
export async function indexStates(db: Executor, textKey: string) {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      contentHash: videos.contentHash,
      indexHash: videos.indexHash,
      imageCheckedAt: videos.imageCheckedAt,
      imageError: videos.imageError,
      imageModel: images.modelKey,
      textCurrent: exists(
        db
          .select({ one: sql`1` })
          .from(passages)
          .where(and(eq(passages.videoId, videos.id), eq(passages.modelKey, textKey))),
      ).mapWith(Boolean),
    })
    .from(videos)
    .leftJoin(images, eq(images.videoId, videos.id))
    .where(
      and(
        eq(videos.available, true),
        exists(
          db
            .select({ one: sql`1` })
            .from(memberships)
            .where(
              and(eq(memberships.videoId, videos.id), eq(memberships.active, true)),
            ),
        ),
      ),
    );
}
