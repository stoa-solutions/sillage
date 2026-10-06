import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LibraryStore } from "../src/db";
import { parseImport, buildDocument } from "../src/import";

const raw = (title = "Romantic Jazz", playlist = "p") => ({
  playlist: { id: playlist, title: playlist },
  videos: [{ id: "swqpIE45v4c", title, duration_seconds: 26796 }],
});
describe("persistent library", () => {
  it("initializes the library and its precomputed vectors together", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    const data = parseImport(raw());
    await store.import(data, [
      {
        id: "swqpIE45v4c",
        text: buildDocument(data.videos[0]!),
        modelKey: "seed",
        vector: [1, 0],
      },
    ]);
    expect((await store.read()).playlists).toHaveLength(1);
    expect((await store.vectors("seed")).size).toBe(1);
  });
  it("does not leave a half-initialized library when a seed vector is invalid", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    const data = parseImport(raw());
    await expect(
      store.import(data, [
        {
          id: "swqpIE45v4c",
          text: buildDocument(data.videos[0]!),
          modelKey: "seed",
          vector: [NaN],
        },
      ]),
    ).rejects.toThrow();
    expect((await store.read()).playlists).toHaveLength(0);
    expect((await store.vectors("seed")).size).toBe(0);
  });
  it("keeps a cached vector across identical imports and invalidates it when text changes", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    const data = parseImport(raw());
    await store.import(data);
    await store.putVectors([
      {
        id: "swqpIE45v4c",
        text: buildDocument(data.videos[0]!),
        modelKey: "test-model",
        vector: [1, 0],
      },
    ]);
    await store.import(parseImport(raw()));
    expect((await store.vectors("test-model")).size).toBe(1);
    await store.import(parseImport(raw("Changed title")));
    expect((await store.vectors("test-model")).size).toBe(0);
  });
  it("does not overwrite a library with an incomplete replacement and preserves other playlists", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    await store.import(parseImport(raw()));
    await store.import(parseImport(raw("Romantic Jazz", "p2")));
    const library = await store.read();
    expect(library.playlists).toHaveLength(2);
    expect(library.videos).toHaveLength(1);
    expect(library.memberships).toHaveLength(2);
  });
  it("rejects stale indexing writes after a new import", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    const old = parseImport(raw());
    await store.import(old);
    await store.import(parseImport(raw("Updated")));
    await store.putVectors([
      {
        id: "swqpIE45v4c",
        text: buildDocument(old.videos[0]!),
        modelKey: "test-model",
        vector: [1, 0],
      },
    ]);
    expect((await store.vectors("test-model")).size).toBe(0);
  });
  it("persists saved data across store instances and does not reuse another model", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = new LibraryStore(name);
    const data = parseImport(raw());
    await first.import(data);
    await first.putVectors([
      {
        id: "swqpIE45v4c",
        text: buildDocument(data.videos[0]!),
        modelKey: "v1",
        vector: [1, 0],
      },
    ]);
    const second = new LibraryStore(name);
    expect((await second.read()).videos[0]!.title).toBe("Romantic Jazz");
    expect((await second.vectors("v1")).size).toBe(1);
    expect((await second.vectors("v2")).size).toBe(0);
  });
  it("replaces an old duration with an explicitly unknown duration even if title is unavailable", async () => {
    const store = new LibraryStore(`test-${crypto.randomUUID()}`);
    await store.import(parseImport(raw()));
    await store.import(
      parseImport({
        playlist: { id: "p" },
        videos: [{ id: "swqpIE45v4c", title: null, duration_seconds: null }],
      }),
    );
    expect((await store.read()).videos[0]!.title).toBeNull();
    expect((await store.read()).videos[0]!.durationSeconds).toBeNull();
  });
});
