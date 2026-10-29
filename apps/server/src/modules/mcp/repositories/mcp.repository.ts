import {
  and,
  asc,
  count,

  eq,
  ilike,
  inArray,
  isNotNull,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DjTrack } from "@sillage/core/dj";
import type { MusicMetadata } from "@sillage/core/types";
import {
  listeningHistory,
  memberships,
  playlists,
  userPlaylists,
  videos,
  type Executor,
} from "../../../db/index.ts";
import { followedBy, inLibraryOf } from "../../library/index.ts";

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const playable = and(eq(videos.available, true), isNotNull(videos.title));

/** Playable titles of the account, for the deterministic request resolver; null above 10 000. */
export async function playableTitles(db: Executor, userId: string) {
  const rows = await db
    .select({ id: videos.id, title: videos.title, channel: videos.channel })
    .from(videos)
    .where(and(playable, inLibraryOf(db, userId, videos.id)))
    .orderBy(asc(videos.id))
    .limit(10001);
  if (rows.length > 10000) return null;
  return rows.map((row) => ({ ...row, title: row.title ?? "" }));
}

/** The account's playable tracks among these ids, in the order asked, without duplicates. */
export async function ownedTracks(
  db: Executor,
  ids: string[],
  userId: string,
): Promise<DjTrack[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      channel: videos.channel,
      durationSeconds: videos.durationSeconds,
      thumbnailUrl: videos.thumbnailUrl,
      musicMetadata: videos.musicMetadata,
    })
    .from(videos)
    .where(
      and(inArray(videos.id, ids), playable, inLibraryOf(db, userId, videos.id)),
    );
  const tracks = new Map(
    rows.map((v) => [
      v.id,
      {
        id: v.id,
        musicMetadata: (v.musicMetadata as MusicMetadata | null) ?? null,
        title: v.title ?? "",
        channel: v.channel,
        durationSeconds: v.durationSeconds,
        thumbnailUrl: v.thumbnailUrl,
        url: watchUrl(v.id),
      },
    ]),
  );
  return [...new Set(ids)].flatMap((id) => {
    const track = tracks.get(id);
    return track ? [track] : [];
  });
}

/** The account's first 30 playlists with their active track counts. */
export async function ownedPlaylists(db: Executor, userId: string) {
  const tracks = db
    .select({ count: count() })
    .from(memberships)
    .where(
      and(eq(memberships.playlistId, playlists.id), eq(memberships.active, true)),
    );
  return db
    .select({
      id: playlists.id,
      title: playlists.title,
      tracks: sql<number>`(${tracks})::int`,
    })
    .from(playlists)
    .where(followedBy(db, userId, playlists.id))
    .orderBy(asc(playlists.createdAt))
    .limit(30);
}

const containing = (value: string) =>
  `%${value.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
/** A JSON array of the metadata, or an empty one when absent or of another type. */
const metadataArray = (key: string) =>
  sql`(CASE WHEN jsonb_typeof(${videos.musicMetadata}->${key})='array' THEN ${videos.musicMetadata}->${key} ELSE '[]'::jsonb END)`;

/** What « forgotten » means: added long ago, not heard lately. */
export const FORGOTTEN = { addedDaysAgo: 180, unheardDays: 60 } as const;

/**
 * Owned, available tracks ordered by when they were first added to a playlist, or, for
 * `forgotten`, old additions not heard lately in a new random order at each call.
 */
export async function browseOwnedTracks(
  db: Executor,
  userId: string,
  filter: {
    playlistId?: string | undefined;
    artist?: string | undefined;
    genre?: string | undefined;
    order: "recent" | "oldest" | "forgotten";
    limit: number;
    excludeIds: string[];
  },
) {
  const addedAt = min(memberships.addedAt);
  const artist = filter.artist ? containing(filter.artist) : null;
  const genre = filter.genre ? containing(filter.genre) : null;
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      channel: videos.channel,
      durationSeconds: videos.durationSeconds,
      thumbnailUrl: videos.thumbnailUrl,
      musicMetadata: videos.musicMetadata,
      addedAt,
    })
    .from(memberships)
    .innerJoin(videos, eq(videos.id, memberships.videoId))
    .where(
      and(
        eq(memberships.active, true),
        playable,
        followedBy(db, userId, memberships.playlistId),
        filter.playlistId ? eq(memberships.playlistId, filter.playlistId) : undefined,
        artist
          ? or(
              ilike(videos.channel, artist),
              ilike(videos.title, artist),
              sql`EXISTS(SELECT 1 FROM jsonb_array_elements(${metadataArray("artists")}) a WHERE a->>'name' ILIKE ${artist})`,
            )
          : undefined,
        genre
          ? sql`EXISTS(SELECT 1 FROM jsonb_array_elements_text(${metadataArray("genres")} || ${metadataArray("artistGenres")}) g WHERE g ILIKE ${genre})`
          : undefined,
        filter.excludeIds.length ? notInArray(videos.id, filter.excludeIds) : undefined,
        filter.order === "forgotten"
          ? sql`NOT EXISTS(SELECT 1 FROM ${listeningHistory} h WHERE h.user_id=${userId} AND h.video_id=${videos.id} AND h.played_at > now() - make_interval(days => ${FORGOTTEN.unheardDays}))`
          : undefined,
      ),
    )
    .groupBy(videos.id)
    .having(
      filter.order === "forgotten"
        ? sql`${addedAt} < now() - make_interval(days => ${FORGOTTEN.addedDaysAgo})`
        : undefined,
    )
    .orderBy(
      filter.order === "forgotten"
        ? sql`random()`
        : filter.order === "oldest"
          ? sql`${addedAt} ASC NULLS LAST`
          : sql`${addedAt} DESC NULLS LAST`,
      asc(videos.id),
    )
    .limit(filter.limit);
  return rows.map((v) => ({
    id: v.id,
    title: v.title,
    channel: v.channel,
    durationSeconds: v.durationSeconds,
    thumbnailUrl: v.thumbnailUrl,
    url: watchUrl(v.id),
    musicMetadata: (v.musicMetadata as MusicMetadata | null) ?? null,
    addedAt: v.addedAt ? v.addedAt.toISOString().slice(0, 10) : null,
  }));
}

