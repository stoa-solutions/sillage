import type { Database } from "../../db/index.ts";
import type {
  Lyrics,
  LyricsRecord,
  LyricsSource,
  LyricsStatus,
} from "../../integrations/lrclib/index.ts";
import { chooseRecord, fromRecord, lyricsQueries } from "./lyrics.matching.ts";
import {
  cachedLyrics,
  lyricsOffset,
  ownedVideo,
  saveLyrics,
  saveLyricsOffset,
} from "./lyrics.repository.ts";

const FOUND_DAYS = 30;
const MISSING_DAYS = 7;

/** Lyrics of a video in the account's library; null when the video is not theirs. */
export async function lyricsFor(
  db: Database,
  source: LyricsSource,
  userId: string,
  videoId: string,
): Promise<Lyrics | null> {
  const video = await ownedVideo(db.orm, userId, videoId);
  if (!video) return null;
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
    source: row.sourceId ? { name: "LRCLIB", id: row.sourceId } : null,
  });
  if (cached?.fresh) return stored(cached);
  const facts = {
    title: video.title ?? "",
    channel: video.channel,
    durationSeconds: video.durationSeconds,
  };
  let record: LyricsRecord | undefined;
  try {
    for (const query of lyricsQueries(facts.title, facts.channel)) {
      record = chooseRecord(await source.search(query), query, facts);
      if (record) break;
    }
  } catch {
    // A busy or failing source never blocks playback: keep stale lyrics or say "later".
    return cached
      ? stored(cached)
      : {
          status: "unavailable",
          lines: [],
          text: null,
          offsetMs,
          durationDeltaMs: null,
          source: null,
        };
  }
  const found = fromRecord(record);
  const durationDeltaMs =
    record?.duration != null && facts.durationSeconds != null
      ? Math.round((facts.durationSeconds - record.duration) * 1000)
      : null;
  await saveLyrics(db.orm, {
    videoId,
    status: found.status,
    sourceId: record?.id ?? null,
    lines: found.lines,
    plainText: found.text,
    durationDeltaMs,
  });
  return {
    ...found,
    offsetMs,
    durationDeltaMs,
    source: record ? { name: "LRCLIB", id: record.id } : null,
  };
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
