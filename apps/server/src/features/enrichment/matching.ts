import type { MusicMetadata } from "@playlist-recall/core/types";

export interface SourceTrack {
  title: string;
  channel: string | null;
  durationSeconds: number | null;
}
export interface Credit {
  name?: string;
  joinphrase?: string;
  artist: { id: string; name: string };
}
export interface Recording {
  id: string;
  title: string;
  length?: number;
  disambiguation?: string;
  "artist-credit"?: Credit[];
  releases?: {
    id: string;
    title: string;
    status?: string;
    date?: string;
    "release-group"?: { id: string; "primary-type"?: string };
  }[];
  genres?: { name: string; count?: number }[];
}
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const cleanTitle = (s: string) =>
  s
    .replace(/\([^)]*\b(?:feat\.?|ft\.?)\s[^)]*\)/gi, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\([^)]*(?:official|lyrics|audio|video|visualizer)[^)]*\)/gi, "")
    .replace(
      /\b(?:official music video|official video|official audio|lyrics video)\b/gi,
      "",
    )
    .trim();
export function sourceIdentity(track: SourceTrack) {
  const parts = track.title.split(/\s+[-–—]\s+/);
  const artist =
    parts.length > 1
      ? parts.shift()!
      : (track.channel ?? "")
          .replace(/\s*-\s*Topic$/i, "")
          .replace(/VEVO$/i, "");
  return { title: cleanTitle(parts.join(" - ")), artist: artist.trim() };
}
export function unsupported(track: SourceTrack) {
  return /\b(type\s?beat|tribute|karaoke|cover|sped up|slowed|colors show)\b/i.test(
    track.title,
  );
}
function version(s: string) {
  return (
    normalize(s)
      .match(/\b(live|remix|acoustic|instrumental|demo)\b/g)
      ?.sort()
      .join(" ") ?? ""
  );
}
export function chooseRecording(track: SourceTrack, recordings: Recording[]) {
  const source = sourceIdentity(track);
  const ranked = recordings
    .map((recording) => {
      const artists = (recording["artist-credit"] ?? [])
        .map((c) => c.name ?? c.artist.name)
        .join(" ");
      const artistWords = normalize(source.artist)
        .split(" ")
        .filter((w) => !["x", "and", "the"].includes(w));
      const artistMatch =
        artistWords.length > 0 &&
        artistWords.every((w) => normalize(artists).split(" ").includes(w));
      const titleMatch =
        normalize(cleanTitle(recording.title)) === normalize(source.title);
      const durationDelta =
        track.durationSeconds != null && recording.length != null
          ? Math.abs(track.durationSeconds - recording.length / 1000)
          : null;
      const sameVersion =
        version(track.title) ===
        version(recording.title + " " + (recording.disambiguation ?? ""));
      const score =
        (titleMatch ? 0.5 : 0) +
        (artistMatch ? 0.3 : 0) +
        (durationDelta != null && durationDelta <= 8 ? 0.2 : 0);
      return {
        recording,
        score,
        accepted:
          titleMatch &&
          artistMatch &&
          sameVersion &&
          durationDelta != null &&
          durationDelta <= 8,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.recording.id.localeCompare(b.recording.id),
    );
  const accepted = ranked.filter((r) => r.accepted);
  // Distinct MusicBrainz recordings can represent different mixes of the same song.
  // Do not resolve that ambiguity by provider relevance score alone.
  const [only] = accepted;
  if (accepted.length !== 1 || only === undefined)
    return {
      status: recordings.length ? "ambiguous" : "not_found",
      score: ranked[0]?.score ?? 0,
    } as const;
  return { status: "matched", ...only } as const;
}
export function metadataFromRecording(
  r: Recording,
  confidence: number,
  checkedAt: string,
  artistGenres: string[],
): MusicMetadata {
  let featured = false;
  const artists = (r["artist-credit"] ?? []).map((c, index, credits) => {
    if (
      index &&
      /\b(feat|ft|featuring)\b/i.test(credits[index - 1]?.joinphrase ?? "")
    )
      featured = true;
    return {
      id: c.artist.id,
      name: c.name ?? c.artist.name,
      role: featured ? ("featured" as const) : ("primary" as const),
    };
  });
  const albums = [
    ...new Map(
      (r.releases ?? [])
        .filter(
          (a) =>
            a.status === "Official" &&
            a["release-group"]?.["primary-type"] === "Album",
        )
        .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
        .map((a) => [
          a["release-group"]!.id,
          { id: a["release-group"]!.id, title: a.title },
        ]),
    ).values(),
  ].slice(0, 5);
  const genres = [
    ...new Set(
      (r.genres ?? []).filter((g) => (g.count ?? 1) > 0).map((g) => g.name),
    ),
  ].slice(0, 12);
  return {
    source: "MusicBrainz",
    status: "matched",
    checkedAt,
    recordingId: r.id,
    confidence,
    artists,
    albums,
    genres,
    artistGenres,
    searchText: [
      r.title,
      ...artists.map((a) => a.name),
      ...albums.map((a) => a.title),
      ...genres,
    ].join(" \n"),
  };
}
