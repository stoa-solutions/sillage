import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { documentText, hash } from "../../content.ts";
import { channels, videos, type Database, type Executor } from "../../db/index.ts";
import type { YouTube } from "../../integrations/youtube/index.ts";
import { enqueue } from "../jobs/index.ts";
import { upsertVideo } from "./store.ts";

/**
 * Full YouTube metadata for up to 50 videos. A video YouTube no longer returns is marked
 * unavailable rather than deleted: playlists and history keep it.
 */
export async function enrichVideos(
  db: Database,
  youtube: YouTube,
  ids: string[],
) {
  const found = await youtube.videos(ids);
  const returned = new Set(found.map((v) => v.id));
  await db.orm.transaction(async (tx) => {
    for (const v of found) await upsertVideo(tx, v, true);
    const missing = ids.filter((id) => !returned.has(id));
    if (missing.length)
      await tx
        .update(videos)
        .set({ available: false, enrichedAt: sql`now()` })
        .where(inArray(videos.id, missing));
  });
  await refreshChannelAvatars(
    db.orm,
    youtube,
    found.map((v) => v.channelId),
  );
  for (const v of found) {
    await enqueue(db.orm, "text", `${v.id}:${hash(documentText(v))}`, {
      videoId: v.id,
    });
    await enqueue(db.orm, "image", v.id, { videoId: v.id });
  }
}

/** Photos are decoration: a YouTube failure leaves the initial shown by the apps. */
async function refreshChannelAvatars(
  db: Executor,
  youtube: YouTube,
  channelIds: (string | null)[],
) {
  const ids = [...new Set(channelIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const fresh = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        inArray(channels.id, ids),
        gt(channels.fetchedAt, sql`now() - interval '30 days'`),
      ),
    );
  const known = new Set(fresh.map((row) => row.id));
  const stale = ids.filter((id) => !known.has(id));
  if (!stale.length) return;
  let avatars: Map<string, string>;
  try {
    avatars = await youtube.channelAvatars(stale);
  } catch {
    return;
  }
  for (const id of stale)
    await db
      .insert(channels)
      .values({ id, avatarUrl: avatars.get(id) ?? null, fetchedAt: sql`now()` })
      .onConflictDoUpdate({
        target: channels.id,
        set: {
          avatarUrl: sql`COALESCE(excluded.avatar_url, ${channels.avatarUrl})`,
          fetchedAt: sql`now()`,
        },
      });
}
