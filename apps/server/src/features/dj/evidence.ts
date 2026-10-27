import type { SearchFailure } from "../discovery/index.ts";
import type { DjTrack } from "../../music-mcp.ts";

export interface DiscoveryEvidence {
  video: DjTrack;
  inLibrary: boolean;
}

const TOOL_CONTEXT_LIMIT = 20_000;

function shortText(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}
function shortList(value: unknown, count: number, length: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, count)
        .map((item) => item.slice(0, length))
    : [];
}

/** Retain musical clues; images, URLs and the duplicate search document cost context but add no evidence. */
export function compactVideo(video: DjTrack) {
  const metadata = video.musicMetadata;
  return {
    id: video.id,
    title: shortText(video.title, 300),
    channel: shortText(video.channel, 120),
    durationSeconds: video.durationSeconds,
    ...(metadata
      ? {
          musicMetadata: {
            source: "MusicBrainz",
            status: metadata.status,
            artists: Array.isArray(metadata.artists)
              ? metadata.artists.slice(0, 6).map((artist) => ({
                  name: shortText(artist?.name, 80),
                  role: artist?.role,
                }))
              : [],
            albums: Array.isArray(metadata.albums)
              ? metadata.albums
                  .slice(0, 3)
                  .map((album) => ({ title: shortText(album?.title, 100) }))
              : [],
            genres: shortList(metadata.genres, 8, 40),
            artistGenres: shortList(metadata.artistGenres, 8, 40),
          },
        }
      : {}),
    matchReason: shortText(
      (video as DjTrack & { matchReason?: string }).matchReason,
      220,
    ),
    addedAt: shortText((video as DjTrack & { addedAt?: string }).addedAt, 10),
  };
}

/** Interleave owned and external candidates so a large enriched library cannot hide discovery. */
function balancedCandidates(items: DiscoveryEvidence[]) {
  const owned = items.filter((item) => item.inLibrary);
  const external = items.filter((item) => !item.inLibrary);
  const result: DiscoveryEvidence[] = [];
  for (
    let index = 0;
    index < Math.max(owned.length, external.length);
    index++
  ) {
    const own = owned[index];
    const other = external[index];
    if (own) result.push(own);
    if (other) result.push(other);
  }
  return result;
}

function compactSearch(
  name: string,
  data: Record<string, unknown>,
  items: DiscoveryEvidence[],
) {
  const owned = name === "library_search" || name === "library_browse";
  const key = owned ? "tracks" : "results";
  const values: unknown[] = [];
  const shown: DiscoveryEvidence[] = [];
  const envelope = {
    [key]: values,
    ...(Array.isArray(data["queries"]) ? {queries:shortList(data["queries"],3,200)} : {}),
    sources: Array.isArray(data["sources"])
      ? data["sources"].slice(0, 3).map((source) => ({
          source: shortText(source?.source, 20),
          status: shortText(source?.status, 20),
          reason: shortText(source?.reason, 40),
          note: shortText(source?.note, 200),
        }))
      : undefined,
    ...(name === "library_browse"
      ? {
          playlists: compactPlaylists(data["playlists"]),
          order: shortText(data["order"], 10),
          playlist: shortText(data["playlist"], 300),
        }
      : {}),
    mode: shortText(data["mode"], 20),
    degraded: shortText(data["degraded"], 220),
    note: shortText(data["note"], 220),
    omittedCandidates: items.length,
  };
  for (const item of balancedCandidates(items)) {
    const video = compactVideo(item.video);
    values.push(owned ? video : { video, inLibrary: item.inLibrary });
    envelope.omittedCandidates = items.length - shown.length - 1;
    if (JSON.stringify(envelope).length > TOOL_CONTEXT_LIMIT) {
      values.pop();
      envelope.omittedCandidates++;
    } else shown.push(item);
  }
  // Only candidates actually shown to the model can become executable.
  return { text: JSON.stringify(envelope), items: shown };
}

function compactPlaylists(value: unknown) {
  if (!Array.isArray(value)) throw new Error("invalid tool result");
  const playlists = value.slice(0, 30).map((playlist) => ({
    id: shortText(playlist?.id, 160),
    title: shortText(playlist?.title, 300),
    tracks: typeof playlist?.tracks === "number" ? playlist.tracks : undefined,
  }));
  while (JSON.stringify({ playlists }).length > TOOL_CONTEXT_LIMIT / 4)
    playlists.pop();
  return playlists;
}

/** A whole tool response is validated before any candidate becomes executable. */
export function readToolEvidence(
  name: string,
  result: Record<string, unknown>,
) {
  if (result["isError"] || !Array.isArray(result["content"]))
    throw new Error("tool unavailable");
  const text = result["content"]
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const data = JSON.parse(text);
  if (name === "seekInformation") {
    const sources = Array.isArray(data.sources) ? data.sources.slice(0, 5) : [];
    return {
      text: JSON.stringify({
        status: data.status,
        sources,
      }),
      items: [],
      isSearch: false,
      failedSources: 0,
      failures: [],
      recoveredSources: [],
      youtubeDailyQuota: false,
      visualUnsupported: false,
    };
  }
  const isSearch = [
    "library_search",
    "library_browse",
    "youtube_search",
    "music_search",
  ].includes(name);
  let items: DiscoveryEvidence[] = [];
  if (isSearch) {
    const owned = name === "library_search" || name === "library_browse";
    const values = owned ? data.tracks : data.results;
    if (!Array.isArray(values)) throw new Error("invalid tool result");
    items = owned ? values.map((video) => ({ video, inLibrary: true })) : values;
    if (
      items.some(
        (item) =>
          !item?.video ||
          !/^[\w-]{11}$/.test(item.video.id) ||
          typeof item.video.title !== "string" ||
          typeof item.inLibrary !== "boolean",
      )
    )
      throw new Error("invalid tool result");
  }
  const failures: SearchFailure[] =
    name === "music_search" && Array.isArray(data.sources)
      ? data.sources
          .filter((source: { status?: string }) => source?.status === "error")
          .map(
            (source: { source?: string; reason?: string }): SearchFailure => ({
              source:
                source.source === "youtube" || source.source === "library"
                  ? source.source
                  : "search",
              reason: [
                "daily_quota",
                "rate_or_quota",
                "not_configured",
                "access_denied",
                "local_budget",
                "search_unavailable",
                "search_blocked",
              ].includes(source.reason ?? "")
                ? (source.reason as SearchFailure["reason"])
                : "unavailable",
            }),
          )
      : [];
  const failedSources = failures.length;
  const youtubeDailyQuota =
    name === "music_search" &&
    Array.isArray(data.sources) &&
    data.sources.some(
      (source: { source?: string; status?: string; reason?: string }) =>
        source.source === "youtube" &&
        source.status === "error" &&
        source.reason === "daily_quota",
    );
  const visualUnsupported =
    name === "music_search" &&
    !items.length &&
    Array.isArray(data.sources) &&
    data.sources.every(
      (source: { status?: string }) => source.status === "unsupported",
    );
  if (!isSearch) throw new Error("unknown tool result");
  const context = compactSearch(name, data, items);
  return {
    ...context,
    isSearch,
    failedSources,
    failures,
    recoveredSources:
      name === "music_search" && Array.isArray(data.sources)
        ? data.sources
            .filter((source: { status?: string }) => source?.status === "ok")
            .map((source: { source?: string }) => source.source)
            .filter(
              (source: unknown): source is "library" | "youtube" =>
                source === "library" || source === "youtube",
            )
        : [],
    visualUnsupported,
    youtubeDailyQuota,
  };
}
