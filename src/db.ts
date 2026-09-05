import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { buildDocument } from "./import";
import type {
  LibraryImport,
  Membership,
  Playlist,
  VectorRecord,
  Video,
} from "./types";

interface LibrarySchema extends DBSchema {
  videos: { key: string; value: Video };
  playlists: { key: string; value: Playlist };
  memberships: {
    key: string;
    value: Membership;
    indexes: { playlistId: string };
  };
  vectors: { key: string; value: VectorRecord };
}

function validateVectors(records: VectorRecord[]): void {
  if (
    records.some(
      (r) =>
        !r.vector?.length ||
        !r.vector.every(Number.isFinite) ||
        !r.vector.some((x) => x !== 0),
    )
  )
    throw new Error("Un vecteur est invalide. Relancez son indexation.");
}

export class LibraryStore {
  private database: Promise<IDBPDatabase<LibrarySchema>>;
  constructor(name = "playlist-recall-v1") {
    this.database = openDB<LibrarySchema>(name, 1, {
      upgrade(db) {
        db.createObjectStore("videos", { keyPath: "id" });
        db.createObjectStore("playlists", { keyPath: "id" });
        db.createObjectStore("memberships", { keyPath: "key" }).createIndex(
          "playlistId",
          "playlistId",
        );
        db.createObjectStore("vectors", { keyPath: "id" });
      },
    });
  }

  async read(): Promise<LibraryImport> {
    const db = await this.database;
    const tx = db.transaction(
      ["videos", "playlists", "memberships"],
      "readonly",
    );
    const [videos, playlists, memberships] = await Promise.all([
      tx.objectStore("videos").getAll(),
      tx.objectStore("playlists").getAll(),
      tx.objectStore("memberships").getAll(),
    ]);
    await tx.done;
    return { videos, playlists, memberships };
  }

  async import(
    data: LibraryImport,
    seedVectors: VectorRecord[] = [],
  ): Promise<void> {
    validateVectors(seedVectors);
    const db = await this.database;
    const tx = db.transaction(
      ["videos", "playlists", "memberships", "vectors"],
      "readwrite",
    );
    try {
      for (const playlist of data.playlists) {
        const oldKeys = await tx
          .objectStore("memberships")
          .index("playlistId")
          .getAllKeys(playlist.id);
        for (const key of oldKeys)
          await tx.objectStore("memberships").delete(key);
        await tx.objectStore("playlists").put(playlist);
      }
      for (const incoming of data.videos) {
        const old = await tx.objectStore("videos").get(incoming.id);
        const video = incoming;
        if (!old || buildDocument(old) !== buildDocument(video))
          await tx.objectStore("vectors").delete(video.id);
        await tx.objectStore("videos").put(video);
      }
      for (const membership of data.memberships)
        await tx.objectStore("memberships").put(membership);
      const liveIds = new Set(
        (await tx.objectStore("memberships").getAll()).map((m) => m.videoId),
      );
      for (const id of await tx.objectStore("videos").getAllKeys()) {
        if (!liveIds.has(id)) {
          await tx.objectStore("videos").delete(id);
          await tx.objectStore("vectors").delete(id);
        }
      }
      for (const record of seedVectors) {
        const video = await tx.objectStore("videos").get(record.id);
        if (video && record.text === buildDocument(video))
          await tx.objectStore("vectors").put(record);
      }
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* An IDB failure may already have aborted it. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  async putVectors(records: VectorRecord[]): Promise<void> {
    validateVectors(records);
    const db = await this.database;
    const tx = db.transaction(["videos", "vectors"], "readwrite");
    for (const record of records) {
      const video = await tx.objectStore("videos").get(record.id);
      // A stale worker result must not overwrite an embedding after a new import.
      if (video && record.text === buildDocument(video))
        await tx.objectStore("vectors").put(record);
    }
    await tx.done;
  }

  async vectors(modelKey: string): Promise<Map<string, number[]>> {
    const db = await this.database;
    const tx = db.transaction(["videos", "vectors"], "readonly");
    const [videos, records] = await Promise.all([
      tx.objectStore("videos").getAll(),
      tx.objectStore("vectors").getAll(),
    ]);
    const documents = new Map(videos.map((v) => [v.id, buildDocument(v)]));
    await tx.done;
    return new Map(
      records
        .filter(
          (r) => r.modelKey === modelKey && documents.get(r.id) === r.text,
        )
        .map((r) => [r.id, r.vector]),
    );
  }
}
