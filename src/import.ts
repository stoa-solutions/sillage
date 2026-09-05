import type { LibraryImport, Video } from "./types";

const MAX_ENTRIES = 50_000;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Le fichier ne contient pas une playlist JSON valide.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, limit = 1000): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : null;

export function parseImport(input: unknown): LibraryImport {
  const source = object(input);
  if (
    source.format === "playlist-recall" &&
    Array.isArray(source.collections)
  ) {
    if (!source.collections.length || source.collections.length > 100)
      throw new Error("La sauvegarde doit contenir entre 1 et 100 playlists.");
    const parts = source.collections.map(parseSingle);
    if (parts.reduce((n, p) => n + p.memberships.length, 0) > MAX_ENTRIES)
      throw new Error("Maximum 50 000 entrées par import.");
    if (
      new Set(parts.flatMap((p) => p.playlists.map((p) => p.id))).size !==
      parts.length
    )
      throw new Error("Identifiants de playlist répétés dans la sauvegarde.");
    return {
      playlists: parts.flatMap((p) => p.playlists),
      memberships: parts.flatMap((p) => p.memberships),
      videos: [
        ...new Map(
          parts.flatMap((p) => p.videos).map((v) => [v.id, v]),
        ).values(),
      ],
    };
  }
  return parseSingle(source);
}

function parseSingle(input: unknown): LibraryImport {
  const source = object(input);
  const normalized = "videos" in source;
  const playlist = normalized ? object(source.playlist) : source;
  const id = text(playlist.id, 160);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error("Identifiant de playlist absent ou invalide.");
  const entries = normalized ? source.videos : source.entries;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw new Error(
      "La liste de vidéos est invalide (maximum 50 000 entrées).",
    );
  const videos = new Map<string, Video>();
  const memberships = entries.map((item, index) => {
    const row = object(item);
    const videoId = text(row.id);
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      throw new Error(`Identifiant vidéo invalide à l'entrée ${index + 1}.`);
    const duration = normalized ? row.duration_seconds : row.duration;
    if (
      duration != null &&
      (typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration < 0)
    )
      throw new Error(`Durée invalide à l'entrée ${index + 1}.`);
    const tags = Array.isArray(row.tags)
      ? row.tags
          .filter((t): t is string => typeof t === "string")
          .slice(0, 100)
          .map((t) => t.slice(0, 100))
      : [];
    const video: Video = {
      id: videoId,
      title: text(row.title, 1000),
      channel: text(row.channel ?? row.uploader, 300),
      durationSeconds: typeof duration === "number" ? duration : null,
      description: text(row.description, 10000) ?? "",
      tags,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt:
        typeof row.upload_date === "string" &&
        /^\d{4}-?\d{2}-?\d{2}$/.test(row.upload_date)
          ? row.upload_date
          : null,
    };
    const old = videos.get(videoId);
    if (!old || video.title) videos.set(videoId, video);
    const suppliedPosition = normalized ? row.position : row.playlist_index;
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
  return {
    playlists: [
      {
        id,
        title: text(playlist.title, 500) ?? "Playlist sans titre",
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
  return {
    format: "playlist-recall",
    version: 1,
    collections: library.playlists.map((playlist) => ({
      playlist: { id: playlist.id, title: playlist.title },
      videos: library.memberships
        .filter((m) => m.playlistId === playlist.id)
        .sort((a, b) => a.position - b.position)
        .map((m) => {
          const v = videos.get(m.videoId)!;
          return {
            id: v.id,
            title: v.title,
            channel: v.channel,
            duration_seconds: v.durationSeconds,
            description: v.description,
            tags: v.tags,
            upload_date: v.publishedAt,
            position: m.position,
          };
        }),
    })),
  };
}
