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
