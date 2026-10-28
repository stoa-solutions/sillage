import {
  exportLibrary as exportFormat,
  parseImport,
} from "@sillage/core/import";
import type { LibraryImport } from "@sillage/core/types";
import { parsePlaylistId } from "../../content.ts";
import { LEGACY_USER_ID, type Database } from "../../db/index.ts";
import { enqueueMissing } from "../indexing/index.ts";
import { enqueue } from "../jobs/index.ts";
import {
  followPlaylist,
  followsPlaylist,
  importIntoLegacyLibrary,
  libraryOf,
  libraryStatus,
  listPlaylists,
  unfollowPlaylist,
} from "./library.repository.ts";

/** Maintenance import of a backup into the historical account, then its missing indexes. */
export async function importLibrary(db: Database, library: LibraryImport) {
  await importIntoLegacyLibrary(db.orm, library);
  await enqueueMissing(db);
}

/** The account's library: playlists it follows, their state, export and import. */
export function libraryService(db: Database) {
  return {
    async status(userId: string) {
      const { counts, jobs } = await libraryStatus(db.orm, userId);
      return {
        counts,
        jobs,
        syncEnabled: process.env["SYNC_ENABLED"] === "true",
        youtubeConfigured: Boolean(process.env["YOUTUBE_API_KEY"]),
        visionEnabled: process.env["VISION_ENABLED"] === "true",
      };
    },
    /** Historical snake_case shape; generation stays a string, as PostgreSQL bigint was. */
    async playlists(userId: string) {
      const rows = await listPlaylists(db.orm, userId);
      return rows.map(({ playlist: p, entries }) => ({
        id: p.id,
        title: p.title,
        source_url: p.sourceUrl,
        created_at: p.createdAt.toISOString(),
        last_sync_at: p.lastSyncAt?.toISOString() ?? null,
        next_sync_at: p.nextSyncAt.toISOString(),
        sync_enabled: p.syncEnabled,
        generation: String(p.generation),
        status: p.status,
        error: p.error,
        entries,
      }));
    },
    /** Follows a YouTube playlist by link and queues its synchronisation. */
    async follow(userId: string, url: string) {
      const id = parsePlaylistId(url);
      await followPlaylist(db.orm, userId, id);
      const job = await enqueue(db.orm, "sync", id, { playlistId: id });
      return { id, job };
    },
    unfollow: (userId: string, id: string) =>
      unfollowPlaylist(db.orm, userId, id),
    /** null when the account does not follow the playlist. */
    async requestSync(userId: string, idOrUrl: string) {
      const id = parsePlaylistId(idOrUrl);
      if (!(await followsPlaylist(db.orm, userId, id))) return null;
      return enqueue(db.orm, "sync", id, { playlistId: id });
    },
    async export(userId: string) {
      return exportFormat(await libraryOf(db.orm, userId));
    },
    /** null when the account is not the maintenance account. */
    async import(userId: string, body: unknown) {
      if (userId !== LEGACY_USER_ID) return null;
      const data = parseImport(body);
      await importLibrary(db, data);
      return { playlists: data.playlists.length, videos: data.videos.length };
    },
  };
}
