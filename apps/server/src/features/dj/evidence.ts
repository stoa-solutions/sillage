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
function compactVideo(video: DjTrack) {
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
    if (owned[index]) result.push(owned[index]);
    if (external[index]) result.push(external[index]);
  }
  return result;
}

function compactSearch(
  name: string,
  data: Record<string, unknown>,
  items: DiscoveryEvidence[],
) {
  const key = name === "library_search" ? "tracks" : "results";
  const values: unknown[] = [];
  const shown: DiscoveryEvidence[] = [];
  const envelope = {
    [key]: values,
    sources: Array.isArray(data.sources)
      ? data.sources.slice(0, 3).map((source) => ({
          source: shortText(source?.source, 20),
          status: shortText(source?.status, 20),
          reason: shortText(source?.reason, 40),
          note: shortText(source?.note, 200),
        }))
      : undefined,
    mode: shortText(data.mode, 20),
    degraded: shortText(data.degraded, 220),
    note: shortText(data.note, 220),
    omittedCandidates: items.length,
  };
  for (const item of balancedCandidates(items)) {
    const video = compactVideo(item.video);
    values.push(
      name === "library_search" ? video : { video, inLibrary: item.inLibrary },
    );
    envelope.omittedCandidates = items.length - shown.length - 1;
    if (JSON.stringify(envelope).length > TOOL_CONTEXT_LIMIT) {
      values.pop();
      envelope.omittedCandidates++;
    } else shown.push(item);
  }
  // Only candidates actually shown to the model can become executable.
  return { text: JSON.stringify(envelope), items: shown };
}

function compactOverview(data: Record<string, unknown>) {
  if (!Array.isArray(data.playlists)) throw new Error("invalid tool result");
  const playlists = data.playlists.slice(0, 30).map((playlist) => ({
    id: shortText(playlist?.id, 160),
    title: shortText(playlist?.title, 300),
    tracks: typeof playlist?.tracks === "number" ? playlist.tracks : undefined,
  }));
  while (JSON.stringify({ playlists }).length > TOOL_CONTEXT_LIMIT)
    playlists.pop();
  return JSON.stringify({ playlists });
}

/** A whole tool response is validated before any candidate becomes executable. */
export function readToolEvidence(
  name: string,
  result: Record<string, unknown>,
) {
  if (result.isError || !Array.isArray(result.content))
    throw new Error("tool unavailable");
  const text = result.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const data = JSON.parse(text);
  const isSearch = [
    "library_search",
    "youtube_search",
    "music_search",
  ].includes(name);
  let items: DiscoveryEvidence[] = [];
  if (isSearch) {
    const values = name === "library_search" ? data.tracks : data.results;
    if (!Array.isArray(values)) throw new Error("invalid tool result");
    items =
      name === "library_search"
        ? values.map((video) => ({ video, inLibrary: true }))
        : values;
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
  const failedSources =
    name === "music_search" && Array.isArray(data.sources)
      ? data.sources.filter(
          (source: { status?: string }) => source.status === "error",
        ).length
      : 0;
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
  const context = isSearch
    ? compactSearch(name, data, items)
    : { text: compactOverview(data), items: [] };
  return {
    ...context,
    isSearch,
    failedSources,
    visualUnsupported,
    youtubeDailyQuota,
  };
}

/** Explain catalog facts, never repeat a provider's unexecuted action or diagnosis. */
export function discoveryReply(cards: DiscoveryEvidence[]) {
  const credits = cards
    .flatMap(({ video }) => {
      const metadata = video.musicMetadata;
      const artists =
        metadata?.status === "matched" && Array.isArray(metadata.artists)
          ? metadata.artists
              .filter((artist) => typeof artist?.name === "string")
              .map((artist) => artist.name)
          : [];
      return artists.length
        ? [`« ${video.title} » : ${artists.join(", ")} (crédits MusicBrainz).`]
        : [];
    })
    .slice(0, 2)
    .join(" ")
    .slice(0, 700);
  return `Je te propose ${cards.length === 1 ? "ce morceau" : `ces ${cards.length} morceaux`}. ${credits ? credits + " " : ""}Choisis celui que tu veux écouter.`;
}

export function noSelectionReply(
  failedSearches: number,
  currentTitle?: string,
  youtubeDailyQuota = false,
) {
  const reference = currentTitle ? ` autour de « ${currentTitle} »` : "";
  if (youtubeDailyQuota)
    return `YouTube a atteint son quota quotidien de recherche. Je n’ai pas de nouvelle sélection vérifiée${reference} dans les sources choisies. Ta lecture et ta file sont conservées. La recherche YouTube reprendra au renouvellement du quota Google.`;
  return failedSearches
    ? `Une source de recherche n’a pas pu fournir de résultat exploitable ; je n’ai pas de nouvelle sélection vérifiée${reference}. Ta lecture et ta file sont conservées. Réessaie la suite dans un instant.`
    : `Je n’ai pas trouvé de nouvelle sélection compatible${reference} dans les sources choisies. Ta lecture et ta file sont conservées. Tu peux élargir la recherche ou demander une autre ambiance.`;
}
