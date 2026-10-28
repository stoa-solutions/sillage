import type { Database } from "../../db/index.ts";
import {
  LyricsSourceBusy,
  type Lyrics,
  type LyricsRecord,
  type LyricsSource,
  type LyricsStatus,
} from "../../integrations/lrclib/index.ts";
import { chooseRecord, fromRecord, lyricsQueries } from "./lyrics.matching.ts";
import {
  cachedLyrics,
  lyricsBacklog,
  lyricsOffset,
  ownedVideo,
  saveLyrics,
  saveLyricsOffset,
  videoFacts,
} from "./lyrics.repository.ts";

const FOUND_DAYS = 30;
const MISSING_DAYS = 7;
/** Library videos fetched ahead per worker minute: LRCLIB asks for restraint. */
const BACKLOG_BATCH = 10;

/** Where lyrics come from, best first; only LRCLIB is synchronised. */
export interface LyricsSources {
  lrclib: LyricsSource;
  /** YouTube Music's lyrics of this very video (licensed, plain). */
  music?: { lyrics(videoId: string): Promise<{ text: string; provider: string | null } | null> };
  /** lyrics.ovh, plain, by artist and title. */
  ovh?: { lyrics(artist: string, title: string): Promise<string | null> };
  /** Title, channel and duration of a video the server never saw (a YouTube result). */
  describe?(videoId: string): Promise<VideoFacts | null>;
}
export interface VideoFacts {
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  musicMetadata?: unknown;
}
type Found = Omit<Lyrics, "offsetMs">;

/** The artist MusicBrainz credits first, when it matched the video. */
const creditedArtist = (metadata: unknown) => {
  const known = metadata as { status?: string; artists?: { name: string; role: string }[] } | null;
  return known?.status === "matched"
    ? known.artists?.find((artist) => artist.role === "primary")?.name
    : undefined;
};

/**
 * Looks lyrics up and stores them for every account: LRCLIB (synchronised), then YouTube
 * Music's for this video, then lyrics.ovh. Null when a source failed and nothing was found:
 * nothing is stored, the next play tries again.
 */
async function fetchLyrics(
  db: Database,
  sources: LyricsSources,
  videoId: string,
  video: VideoFacts,
): Promise<Found | null> {
  const facts = {
    title: video.title ?? "",
    channel: video.channel,
    durationSeconds: video.durationSeconds,
  };
  const queries = lyricsQueries(facts.title, facts.channel, creditedArtist(video.musicMetadata));
  let failed = false;
  let record: LyricsRecord | undefined;
  try {
    for (const query of queries) {
      record = chooseRecord(await sources.lrclib.search(query), query, facts);
      if (record) break;
    }
  } catch (error) {
    failed = true;
    // A saturated LRCLIB is waited for, not skipped: the other sources are not synchronised.
    if (error instanceof LyricsSourceBusy) return null;
  }
  let found: Found = {
    ...fromRecord(record),
    durationDeltaMs:
      record?.duration != null && facts.durationSeconds != null
        ? Math.round((facts.durationSeconds - record.duration) * 1000)
        : null,
    source: record ? { name: "LRCLIB", id: record.id } : null,
  };
  if (found.status === "missing" && sources.music) {
    try {
      const music = await sources.music.lyrics(videoId);
      if (music)
        found = {
          status: "plain",
          lines: [],
          text: music.text,
          durationDeltaMs: null,
          source: { name: music.provider ? `YouTube Music · ${music.provider}` : "YouTube Music", id: null },
        };
    } catch {
      failed = true;
    }
  }
  const named = queries.find((query) => query.artist && query.track);
  if (found.status === "missing" && sources.ovh && named) {
    try {
      const text = await sources.ovh.lyrics(named.artist!, named.track!);
      if (text)
        found = {
          status: "plain",
          lines: [],
          text,
          durationDeltaMs: null,
          source: { name: "lyrics.ovh", id: null },
        };
    } catch {
      failed = true;
    }
  }
  if (found.status === "missing" && failed) return null;
  await saveLyrics(db.orm, {
    videoId,
    // Never « unavailable » here: a failure returned null above.
    status: found.status as Exclude<LyricsStatus, "unavailable">,
    sourceId: found.source?.id ?? null,
    sourceName: found.source?.name ?? null,
    lines: found.lines,
    plainText: found.text,
    durationDeltaMs: found.durationDeltaMs,
  });
  return found;
}

/**
 * Lyrics of any video: from the library, a discovery or a YouTube result. Null when the
 * server cannot tell which song it is.
 */
export async function lyricsFor(
  db: Database,
  sources: LyricsSources,
  userId: string,
  videoId: string,
): Promise<Lyrics | null> {
  const offsetMs = await lyricsOffset(db.orm, userId, videoId);
  const cached = await cachedLyrics(db.orm, videoId, {
    foundDays: FOUND_DAYS,
    missingDays: MISSING_DAYS,
  });
  const stored = (row: NonNullable<typeof cached>): Lyrics => ({
    status: row.status as LyricsStatus,
    lines: row.lines,
    text: row.plainText,
    offsetMs,
    durationDeltaMs: row.durationDeltaMs,
    source:
      row.sourceName || row.sourceId
        ? { name: row.sourceName ?? "LRCLIB", id: row.sourceId }
        : null,
  });
  if (cached?.fresh) return stored(cached);
  const video =
    (await videoFacts(db.orm, videoId)) ??
    (await sources.describe?.(videoId).catch(() => null)) ??
    null;
  if (!video) return cached ? stored(cached) : null;
  const found = await fetchLyrics(db, sources, videoId, video);
  if (found) return { ...found, offsetMs };
  // A busy or failing source never blocks playback: keep stale lyrics or say "later".
  return cached
    ? stored(cached)
    : { status: "unavailable", lines: [], text: null, offsetMs, durationDeltaMs: null, source: null };
}

/**
 * Worker scheduler: fetches ahead the lyrics of library videos never looked for, then old
 * misses, a few per minute. Stops the batch when LRCLIB asks to wait.
 */
export async function prefetchLyrics(db: Database, sources: LyricsSources, batch = BACKLOG_BATCH) {
  for (const video of await lyricsBacklog(db.orm, batch, MISSING_DAYS)) {
    try {
      if (!(await fetchLyrics(db, sources, video.id, video))) {
        // Null: LRCLIB is saturated or every source failed; the next minute tries again.
        break;
      }
    } catch {
      break;
    }
  }
}

/** Stores the account's correction for one video; zero removes it. False when not theirs. */
export async function setLyricsOffset(
  db: Database,
  userId: string,
  videoId: string,
  offsetMs: number,
) {
  if (!(await ownedVideo(db.orm, userId, videoId))) return false;
  await saveLyricsOffset(db.orm, userId, videoId, offsetMs);
  return true;
}
