import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportLibrary, parseImport } from "@sillage/core/import";
import type { LibraryImport } from "@sillage/core/types";

// Each case pairs an input file with the library it must produce.
const directory = new URL("../../../packages/core/fixtures/format/", import.meta.url);
const cases = readdirSync(directory)
  .filter((name) => name.endsWith(".input.json"))
  .map((name) => name.replace(".input.json", ""));

function canonical(library: LibraryImport) {
  return {
    playlists: library.playlists.map((p) => ({
      id: p.id,
      title: p.title,
      videoIds: library.memberships
        .filter((m) => m.playlistId === p.id)
        .sort((a, b) => a.position - b.position)
        .map((m) => m.videoId),
    })),
    videos: [...library.videos]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({
        id: v.id,
        title: v.title,
        channel: v.channel,
        durationSeconds: v.durationSeconds,
        tags: v.tags,
        publishedAt: v.publishedAt,
      })),
  };
}

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(name, directory), "utf8"));

describe("shared Sillage format fixtures", () => {
  it.each(cases)("%s", (name) => {
    const input = read(`${name}.input.json`);
    const expected = read(`${name}.expected.json`);
    if (expected.error) {
      expect(() => parseImport(input)).toThrow();
      return;
    }
    const parsed = parseImport(input);
    expect(canonical(parsed)).toEqual(expected);
    // An export reads back to the same library, unassigned videos included.
    expect(canonical(parseImport(exportLibrary(parsed)))).toEqual(expected);
  });
});
