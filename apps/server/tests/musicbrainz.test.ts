import { describe, expect, it } from "vitest";
import {
  chooseRecording,
  metadataFromRecording,
  sourceIdentity,
  unsupported,
  type Recording,
} from "../src/modules/enrichment/index.ts";
import { required } from "./support/required.ts";
const track = {
  title: "Incapable (feat. HEDGES)",
  channel: "Jewel Usain - Topic",
  durationSeconds: 214,
};
export const recording: Recording = {
  id: "recording",
  title: "Incapable",
  length: 213000,
  "artist-credit": [
    { artist: { id: "jewel", name: "Jewel Usain" }, joinphrase: " feat. " },
    { artist: { id: "beesau", name: "Béesau" }, joinphrase: " & " },
    { artist: { id: "hedges", name: "Hedges" } },
  ],
  releases: [
    {
      id: "release",
      title: "Où les garçons grandissent",
      status: "Official",
      "release-group": { id: "album", "primary-type": "Album" },
    },
  ],
};
const withoutLength = ({ length: _length, ...rest }: Recording): Recording => rest;
describe("MusicBrainz conservative matching", () => {
  it("recognizes Topic metadata without mistaking features for the title", () => {
    expect(sourceIdentity(track)).toEqual({
      title: "Incapable",
      artist: "Jewel Usain",
    });
    expect(chooseRecording(track, [recording]).status).toBe("matched");
  });
  it("retains both featured credits and keeps artist styles separate", () => {
    const metadata = metadataFromRecording(recording, 1, "now", ["hip hop"]);
    expect(
      metadata.artists.filter((a) => a.role === "featured").map((a) => a.name),
    ).toEqual(["Béesau", "Hedges"]);
    expect(required(metadata.albums[0]).title).toBe("Où les garçons grandissent");
    expect(metadata.genres).toEqual([]);
    expect(metadata.searchText).not.toContain("hip hop");
  });
  it.each([
    { ...recording, length: 250000 },
    { ...recording, title: "Incapable live" },
    { ...recording, disambiguation: "live" },
    {
      ...recording,
      "artist-credit": [{ artist: { id: "other", name: "Other Artist" } }],
    },
    withoutLength(recording),
  ])(
    "refuses conflicting artist, duration, version or missing duration",
    (candidate) => {
      expect(chooseRecording(track, [candidate]).status).toBe("ambiguous");
    },
  );
  it("abstains with competing recordings or no result", () => {
    expect(
      chooseRecording(track, [recording, { ...recording, id: "other" }]).status,
    ).toBe("ambiguous");
    expect(chooseRecording(track, []).status).toBe("not_found");
  });
  it("does not credit a type beat, cover or COLORS performance as the studio recording", () => {
    for (const title of [
      "Mac Miller Type Beat - Losing My Mind",
      "Masego - Navajo | A COLORS SHOW",
      "Incapable cover",
    ])
      expect(unsupported({ ...track, title })).toBe(true);
  });
});
