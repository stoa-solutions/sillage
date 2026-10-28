import type {
  LyricsLine,
  LyricsQuery,
  LyricsRecord,
} from "../../integrations/lrclib/index.ts";

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
  /** The artist MusicBrainz credits, more reliable than the YouTube channel or title. */
  credited?: string,
): LyricsQuery[] {
  const cleaned = cleanTitle(title);
  const queries: LyricsQuery[] = [];
  if (credited) {
    const parts = cleaned.split(/\s[-–—|]\s/);
    const song =
      parts.length >= 2 && normalize(parts[0] ?? "").includes(normalize(credited).split(" ")[0] ?? "")
        ? parts.slice(1).join(" ").trim()
        : cleaned;
    queries.push({ artist: credited, track: song });
  }
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
  const seen = new Set<string>();
  return queries
    .filter((query) => {
      const key = JSON.stringify([query.artist && normalize(query.artist), query.track && normalize(query.track), query.q]);
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, 3);
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

export function fromRecord(record: LyricsRecord | undefined) {
  if (!record) return { status: "missing" as const, lines: [], text: null };
  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length) return { status: "synced" as const, lines, text: null };
  }
  if (record.plainLyrics)
    return { status: "plain" as const, lines: [], text: record.plainLyrics };
  return { status: "instrumental" as const, lines: [], text: null };
}
