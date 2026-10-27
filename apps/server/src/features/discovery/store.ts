import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { MusicMetadata, Video } from "@playlist-recall/core/types";
import { documentText, hash } from "../../content.ts";
import {
  listeningHistory,
  memberships,
  playlists,
  userPlaylists,
  videos,
  type Executor,
} from "../../db/index.ts";
import { enqueue } from "../jobs/index.ts";
import { discoveriesId, followedBy, upsertVideo } from "../library/index.ts";

/** Which of these videos the account already has in an active playlist. */
export async function ownedAmong(db: Executor, userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ id: memberships.videoId })
    .from(memberships)
    .where(
      and(
        eq(memberships.active, true),
        inArray(memberships.videoId, ids),
        followedBy(db, userId, memberships.playlistId),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Saves a YouTube video into the account's private "Mes découvertes" collection, never handed
 * to the playlist synchronizer, and queues its indexes. Adding it again only reactivates it.
 */
export async function saveDiscovery(
  db: Executor,
  userId: string,
  video: Video & { channelId?: string | null },
) {
  const playlistId = discoveriesId(userId);
  await db.transaction(async (tx) => {
    await tx
      .insert(playlists)
      .values({
        id: playlistId,
        title: "Mes découvertes",
        sourceUrl: "",
        syncEnabled: false,
        status: "ready",
      })
      .onConflictDoNothing({ target: playlists.id });
    // Serialises concurrent additions (and removal) so positions stay distinct.
    await tx
      .select({ id: playlists.id })
      .from(playlists)
      .where(eq(playlists.id, playlistId))
      .for("update");
    await tx
      .insert(userPlaylists)
      .values({ userId, playlistId })
      .onConflictDoNothing();
    await upsertVideo(tx, video, true);
    const [last] = await tx
      .select({ position: max(memberships.position) })
      .from(memberships)
      .where(eq(memberships.playlistId, playlistId));
    await tx
      .insert(memberships)
      .values({
        key: `${playlistId}:${video.id}`,
        playlistId,
        videoId: video.id,
        position: (last?.position ?? 0) + 1,
        addedAt: new Date(),
        seenGeneration: 0,
      })
      .onConflictDoUpdate({ target: memberships.key, set: { active: true } });
    await enqueue(tx, "text", `${video.id}:${hash(documentText(video))}`, {
      videoId: video.id,
    });
    if (process.env["VISION_ENABLED"] === "true")
      await enqueue(tx, "image", video.id, { videoId: video.id });
  });
  return playlistId;
}

export interface HistoryRow {
  video_id: string;
  title: string;
  channel: string | null;
  outcome: string;
  music_metadata: MusicMetadata | null;
}

/** The account's 80 latest plays, with the MusicBrainz metadata of videos still known. */
export async function recentListening(
  db: Executor,
  userId: string,
): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      videoId: listeningHistory.videoId,
      title: listeningHistory.title,
      channel: listeningHistory.channel,
      outcome: listeningHistory.outcome,
      musicMetadata: videos.musicMetadata,
    })
    .from(listeningHistory)
    .leftJoin(videos, eq(videos.id, listeningHistory.videoId))
    .where(eq(listeningHistory.userId, userId))
    .orderBy(desc(listeningHistory.playedAt), desc(listeningHistory.eventId))
    .limit(80);
  return rows.map((row) => ({
    video_id: row.videoId,
    title: row.title,
    channel: row.channel,
    outcome: row.outcome,
    music_metadata: (row.musicMetadata as MusicMetadata | null) ?? null,
  }));
}
