import { documentText, hash } from "../../../shared/content.ts";
import type { Database } from "../../../db/index.ts";
import type { YouTube } from "../../../integrations/youtube/index.ts";
import { enqueue } from "../../jobs/index.ts";
import {
  freshChannelIds,
  saveChannelAvatar,
  saveEnrichedVideos,
} from "../repositories/library.repository.ts";

/**
 * Full YouTube metadata for up to 50 videos, then their channel photos and text and image
 * indexes. A video YouTube no longer returns is marked unavailable rather than deleted.
 */
export async function enrichVideos(
  db: Database,
  youtube: YouTube,
  ids: string[],
) {
  const found = await youtube.videos(ids);
  const returned = new Set(found.map((v) => v.id));
  await saveEnrichedVideos(
    db.orm,
    found,
    ids.filter((id) => !returned.has(id)),
  );
  await refreshChannelAvatars(
    db,
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
  db: Database,
  youtube: YouTube,
  channelIds: (string | null)[],
) {
  const ids = [...new Set(channelIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const known = await freshChannelIds(db.orm, ids);
  const stale = ids.filter((id) => !known.has(id));
  if (!stale.length) return;
  let avatars: Map<string, string>;
  try {
    avatars = await youtube.channelAvatars(stale);
  } catch {
    return;
  }
  for (const id of stale)
    await saveChannelAvatar(db.orm, id, avatars.get(id) ?? null);
}
