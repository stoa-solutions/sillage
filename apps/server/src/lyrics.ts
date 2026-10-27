import { ownsPlaylist } from "./features/accounts/index.ts";
import type { Database } from "./db/index.ts";

/** One LRCLIB record, as returned by /api/search. */
export interface LyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration: number | null;
  instrumental: boolean;
  hasWordSync?: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}
export interface LyricsQuery {
  artist?: string;
  track?: string;
  q?: string;
}
/** Where lyrics come from: LRCLIB today, a mirror or a licensed catalogue later. */
export interface LyricsSource {
  search(query: LyricsQuery): Promise<LyricsRecord[]>;
}
export interface LyricsLine {
  startMs: number;
  endMs: number;
  text: string;
}
export type LyricsStatus =
  "synced" | "plain" | "instrumental" | "missing" | "unavailable";
export interface Lyrics {
  status: LyricsStatus;
  lines: LyricsLine[];
  /** Plain text when only unsynchronised lyrics exist. */
  text: string | null;
  /** Account's own correction; positive values delay the lyrics. */
  offsetMs: number;
  /** Video length minus lyrics length; a large gap usually means a clip intro or outro. */
  durationDeltaMs: number | null;
  source: { name: "LRCLIB"; id: number } | null;
}

export class LyricsSourceBusy extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Service de paroles momentanément saturé.");
  }
}

/** LRCLIB client: identified, strictly sequential and spaced, honouring Retry-After. */
export class Lrclib implements LyricsSource {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private blockedUntil = 0;
  constructor(
    private request: typeof fetch = fetch,
    private apiKey = process.env["LRCLIB_API_KEY"],
    private spacingMs = 300,
  ) {}
  search(query: LyricsQuery): Promise<LyricsRecord[]> {
    const run = this.queue.then(() => this.call(query));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async call(query: LyricsQuery, attempt = 0): Promise<LyricsRecord[]> {
    const now = Date.now();
    if (now < this.blockedUntil)
      throw new LyricsSourceBusy(Math.ceil((this.blockedUntil - now) / 1000));
    const wait = this.last + this.spacingMs - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const url = new URL("https://lrclib.net/api/search");
    if (query.q) url.searchParams.set("q", query.q);
    if (query.track) url.searchParams.set("track_name", query.track);
    if (query.artist) url.searchParams.set("artist_name", query.artist);
    const headers: Record<string, string> = {
      "User-Agent": "PlaylistRecall/2.2.0 (https://recall.stoa.solutions)",
    };
    if (this.apiKey) headers["Lrclib-Api-Key"] = this.apiKey;
    try {
      const response = await this.request(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429 || response.status === 503) {
        const seconds = Number(response.headers.get("Retry-After")) || 30;
        // Jitter keeps throttled clients from retrying in a synchronised wave.
        const pause =
          Math.max(seconds, attempt * 2) * 1000 * (1 + Math.random() * 0.3);
        // LRCLIB often answers short transient 503s: wait them out rather than lose the lyrics.
        if (attempt < 2 && seconds <= 5) {
          await new Promise((resolve) => setTimeout(resolve, pause));
          return this.call(query, attempt + 1);
        }
        this.blockedUntil = Date.now() + pause;
        throw new LyricsSourceBusy(seconds);
      }
      if (!response.ok) throw new Error(`LRCLIB HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data) ? (data as LyricsRecord[]) : [];
    } finally {
      this.last = Date.now();
    }
  }
}

const NOISE =
  /official|officiel|video|vidéo|clip|audio|lyrics?|paroles|visuali[sz]er|hd|4k|remaster(?:ed)?|explicit|music/i;
/** Title without "(Official Video)"-style decorations and featured artists. */
export function cleanTitle(title: string) {
  return title
    .replace(/[([【][^)\]】]*[)\]】]/g, (part) =>
      NOISE.test(part) ? " " : part,
    )
    .replace(/\s(?:ft\.?|feat\.?|featuring)\s.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const channelArtist = (channel: string | null) =>
  (channel ?? "")
    .replace(/\s-\sTopic$/, "")
    .replace(/VEVO$/i, "")
    .replace(/\s*(official|officiel)$/i, "")
    .trim();

/** Searches to try, most specific first, from a YouTube title and channel. */
export function lyricsQueries(
  title: string,
  channel: string | null,
): LyricsQuery[] {
  const cleaned = cleanTitle(title);
  const queries: LyricsQuery[] = [];
  if (channel?.endsWith(" - Topic"))
    queries.push({ artist: channelArtist(channel), track: cleaned });
  const split = cleaned.split(/\s[-–—|]\s/);
  if (split.length >= 2)
    queries.push({
      artist: (split[0] ?? "").trim(),
      track: split.slice(1).join(" ").trim(),
    });
  else if (channel && !channel.endsWith(" - Topic"))
    queries.push({ artist: channelArtist(channel), track: cleaned });
  queries.push({ q: cleaned });
  return queries.slice(0, 3);
}

/** Line-synced LRC to lines; blank timed lines end the previous line. */
export function parseLrc(lrc: string): LyricsLine[] {
  let shift = 0;
  const stamps: { at: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const offset = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    // A positive [offset:] shows lyrics sooner.
    if (offset) shift = -Number(offset[1]);
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!times.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const [, minutes, seconds] of times)
      stamps.push({
        at: Math.round(
          (Number(minutes) * 60 + Number((seconds ?? "").replace(":", "."))) * 1000,
        ),
        text,
      });
  }
  stamps.sort((a, b) => a.at - b.at);
  const lines: LyricsLine[] = [];
  stamps.forEach((stamp, i) => {
    if (!stamp.text) return;
    const next = stamps[i + 1]?.at ?? stamp.at + 5000;
    lines.push({
      startMs: Math.max(0, stamp.at + shift),
      endMs: Math.max(0, next + shift),
      text: stamp.text,
    });
  });
  return lines;
}

/** Best record for this video, or undefined when none is the same song. */
export function chooseRecord(
  records: LyricsRecord[],
  query: LyricsQuery,
  video: {
    title: string;
    channel: string | null;
    durationSeconds: number | null;
  },
) {
  const haystack = normalize(`${video.title} ${video.channel ?? ""}`);
  const track = normalize(query.track ?? "");
  const sameSong = (r: LyricsRecord) => {
    const name = normalize(r.trackName ?? "");
    if (
      !name ||
      !(track
        ? name === track || haystack.includes(name)
        : haystack.includes(name))
    )
      return false;
    const artist = normalize(r.artistName ?? "")
      .split(" ")
      .filter((word) => word.length > 1);
    if (artist.length && !artist.some((word) => haystack.includes(word)))
      return false;
    // A record far from the video length is another edit (radio cut, live, snippet).
    return (
      video.durationSeconds == null ||
      r.duration == null ||
      Math.abs(r.duration - video.durationSeconds) <= 30
    );
  };
  const distance = (r: LyricsRecord) =>
    video.durationSeconds == null || r.duration == null
      ? 1e6
      : Math.abs(r.duration - video.durationSeconds);
  const candidates = records
    .filter(sameSong)
    .sort((a, b) => distance(a) - distance(b));
  return (
    candidates.find((r) => r.syncedLyrics) ??
    candidates.find((r) => r.plainLyrics) ??
    candidates.find((r) => r.instrumental)
  );
}

function fromRecord(record: LyricsRecord | undefined) {
  if (!record) return { status: "missing" as const, lines: [], text: null };
  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length) return { status: "synced" as const, lines, text: null };
  }
  if (record.plainLyrics)
    return { status: "plain" as const, lines: [], text: record.plainLyrics };
  return { status: "instrumental" as const, lines: [], text: null };
}

const FOUND_DAYS = 30;
const MISSING_DAYS = 7;

/** Lyrics of a video in the account's library; null when the video is not theirs. */
export async function lyricsFor(
  db: Database,
  source: LyricsSource,
  userId: string,
  videoId: string,
): Promise<Lyrics | null> {
  const video = (
    await db.query(
      `SELECT v.id,v.title,v.channel,v.duration_seconds FROM videos v WHERE v.id=$1
      AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownsPlaylist("m.playlist_id", "$2")})`,
      [videoId, userId],
    )
  ).rows[0];
  if (!video) return null;
  const offsetMs =
    (
      await db.query(
        "SELECT offset_ms FROM lyrics_offsets WHERE user_id=$1 AND video_id=$2",
        [userId, videoId],
      )
    ).rows[0]?.offset_ms ?? 0;
  const cached = (
    await db.query(
      `SELECT *, fetched_at > now() - make_interval(days => CASE WHEN status='missing' THEN $2::int ELSE $3::int END) AS fresh
      FROM lyrics WHERE video_id=$1`,
      [videoId, MISSING_DAYS, FOUND_DAYS],
    )
  ).rows[0];
  const stored = (row: any): Lyrics => ({
    status: row.status,
    lines: row.lines,
    text: row.plain_text,
    offsetMs,
    durationDeltaMs: row.duration_delta_ms,
    source: row.source_id
      ? { name: "LRCLIB", id: Number(row.source_id) }
      : null,
  });
  if (cached?.fresh) return stored(cached);
  const facts = {
    title: video.title ?? "",
    channel: video.channel,
    durationSeconds: video.duration_seconds,
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
  await db.query(
    `INSERT INTO lyrics(video_id,status,source_id,lines,plain_text,duration_delta_ms,fetched_at)
    VALUES($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT(video_id) DO UPDATE SET status=excluded.status,source_id=excluded.source_id,lines=excluded.lines,
    plain_text=excluded.plain_text,duration_delta_ms=excluded.duration_delta_ms,fetched_at=now()`,
    [
      videoId,
      found.status,
      record?.id ?? null,
      JSON.stringify(found.lines),
      found.text,
      durationDeltaMs,
    ],
  );
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
  const owned = await db.query(
    `SELECT 1 FROM memberships m WHERE m.video_id=$1 AND m.active AND ${ownsPlaylist("m.playlist_id", "$2")} LIMIT 1`,
    [videoId, userId],
  );
  if (!owned.rowCount) return false;
  if (offsetMs === 0)
    await db.query(
      "DELETE FROM lyrics_offsets WHERE user_id=$1 AND video_id=$2",
      [userId, videoId],
    );
  else
    await db.query(
      `INSERT INTO lyrics_offsets(user_id,video_id,offset_ms,updated_at) VALUES($1,$2,$3,now())
      ON CONFLICT(user_id,video_id) DO UPDATE SET offset_ms=excluded.offset_ms,updated_at=now()`,
      [userId, videoId, offsetMs],
    );
  return true;
}
