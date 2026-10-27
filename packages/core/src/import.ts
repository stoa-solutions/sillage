import type { LibraryImport, Video } from "./types";
import { sha256Hex } from "./hash";

const MAX_ENTRIES = 50_000;
const MAX_PLAYLISTS = 100;
/** Export bucket for videos outside every playlist. Its videos import; the bucket does not. */
export const UNASSIGNED_ID = "_recall_unassigned";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Le fichier ne contient pas une playlist JSON valide.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, limit = 1000): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : null;

/**
 * Reads a Recall export, a single normalized playlist or a yt-dlp flat playlist.
 * Reference cases, with their expected result, live in packages/core/fixtures/format.
 */
export function parseImport(
  input: unknown,
  fallbackTitle = "Import JSON",
): LibraryImport {
  const source = object(input);
  if (Array.isArray(source["collections"])) {
    const playlists = source["collections"].filter(
      (c) => !isUnassigned(c),
    ).length;
    if (!source["collections"].length || playlists > MAX_PLAYLISTS)
      throw new Error("La sauvegarde doit contenir entre 1 et 100 playlists.");
    const parts = source["collections"].map((c, i) =>
      parseSingle(c, i, fallbackTitle),
    );
    if (parts.reduce((n, p) => n + p.memberships.length, 0) > MAX_ENTRIES)
      throw new Error("Maximum 50 000 entrées par import.");
    const ids = parts.flatMap((p) => p.playlists.map((p) => p.id));
    if (new Set(ids).size !== ids.length)
      throw new Error("Identifiants de playlist répétés dans la sauvegarde.");
    return {
      playlists: parts.flatMap((p) => p.playlists),
      memberships: parts.flatMap((p) => p.memberships),
      videos: [
        ...parts
          .flatMap((p) => p.videos)
          .reduce((all, v) => {
            const old = all.get(v.id);
            if (!old || (!old.title && v.title)) all.set(v.id, v);
            return all;
          }, new Map<string, Video>())
          .values(),
      ],
    };
  }
  return parseSingle(source, 0, fallbackTitle);
}

const isUnassigned = (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  (value as { playlist?: { id?: unknown } }).playlist?.id === UNASSIGNED_ID;

function parseSingle(
  input: unknown,
  index: number,
  fallbackTitle: string,
): LibraryImport {
  const source = object(input);
  const normalized = "videos" in source;
  const playlist = normalized
    ? source["playlist"] == null
      ? {}
      : object(source["playlist"])
    : source;
  // A file without playlist ID gets the same stable ID on every import, so it replaces itself.
  const id =
    text(playlist["id"], 160) ??
    "file_" + sha256Hex(fallbackTitle + String(index)).slice(0, 24);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error("Identifiant de playlist absent ou invalide.");
  const entries = normalized ? source["videos"] : source["entries"];
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw new Error(
      "La liste de vidéos est invalide (maximum 50 000 entrées).",
    );
  const videos = new Map<string, Video>();
  const memberships = entries.map((item, index) => {
    const row = object(item);
    const videoId = text(row["id"]);
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      throw new Error(`Identifiant vidéo invalide à l'entrée ${index + 1}.`);
    const duration = normalized ? row["duration_seconds"] : row["duration"];
    if (
      duration != null &&
      (typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration < 0)
    )
      throw new Error(`Durée invalide à l'entrée ${index + 1}.`);
    const tags = Array.isArray(row["tags"])
      ? row["tags"]
          .filter((t): t is string => typeof t === "string")
          .slice(0, 100)
          .map((t) => t.slice(0, 100))
      : [];
    const video: Video = {
      id: videoId,
      title: text(row["title"], 1000),
      channel: text(row["channel"] ?? row["uploader"], 300),
      durationSeconds: typeof duration === "number" ? duration : null,
      description: text(row["description"], 10000) ?? "",
      tags,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt:
        typeof row["upload_date"] === "string" &&
        /^\d{4}-?\d{2}-?\d{2}$/.test(row["upload_date"])
          ? row["upload_date"]
          : null,
    };
    const old = videos.get(videoId);
    if (!old || (!old.title && video.title)) videos.set(videoId, video);
    const suppliedPosition = normalized ? row["position"] : row["playlist_index"];
    if (
      suppliedPosition != null &&
      (typeof suppliedPosition !== "number" ||
        !Number.isSafeInteger(suppliedPosition) ||
        suppliedPosition < 1)
    )
      throw new Error(`Position invalide à l'entrée ${index + 1}.`);
    return {
      key: `${id}:${index + 1}`,
      playlistId: id,
      videoId,
      position:
        typeof suppliedPosition === "number" ? suppliedPosition : index + 1,
    };
  });
  if (id === UNASSIGNED_ID)
    return { playlists: [], videos: [...videos.values()], memberships: [] };
  return {
    playlists: [
      {
        id,
        title: text(playlist["title"], 500) ?? fallbackTitle,
        sourceUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
        importedAt: new Date().toISOString(),
      },
    ],
    videos: [...videos.values()],
    memberships,
  };
}

/** Document preparation is shared verbatim by browser indexing and the personal seed. */
export function buildDocument(video: Video): string {
  if (!video.title) return "";
  const description = video.description
    .replace(/https?:\/\/\S+/g, "")
    .split("\n")
    .filter(
      (line) =>
        !/subscribe|follow us|all rights reserved|copyright|business inquiries/i.test(
          line,
        ),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  return [
    video.title,
    video.channel ? `Channel: ${video.channel}` : "",
    video.tags.length ? `Tags: ${video.tags.join(", ")}` : "",
    description,
  ]
    .filter(Boolean)
    .join("\n");
}

export function exportLibrary(library: LibraryImport): unknown {
  const videos = new Map(library.videos.map((v) => [v.id, v]));
  const row = (v: Video, position?: number) => ({
    id: v.id,
    title: v.title,
    channel: v.channel,
    duration_seconds: v.durationSeconds,
    description: v.description,
    tags: v.tags,
    upload_date: v.publishedAt,
    ...(position === undefined ? {} : { position }),
  });
  const assigned = new Set(library.memberships.map((m) => m.videoId));
  const unassigned = library.videos.filter((v) => !assigned.has(v.id));
  return {
    format: "playlist-recall",
    version: 1,
    collections: [
      ...library.playlists.map((playlist) => ({
        playlist: { id: playlist.id, title: playlist.title },
        videos: library.memberships
          .filter((m) => m.playlistId === playlist.id)
          .sort((a, b) => a.position - b.position)
          .map((m) => row(videos.get(m.videoId)!, m.position)),
      })),
      ...(unassigned.length
        ? [
            {
              playlist: { id: UNASSIGNED_ID, title: "Autres vidéos" },
              videos: unassigned.map((v) => row(v)),
            },
          ]
        : []),
    ],
  };
}
