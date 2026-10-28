/** One neighbour of an artist in ListenBrainz's listening sessions. */
export interface SimilarArtist {
  mbid: string;
  name: string;
  score: number;
}

const ALGORITHM =
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";
const DAY = 24 * 60 * 60 * 1000;

/**
 * ListenBrainz « similar artists »: free, keyless, by MusicBrainz ID. Answers are kept a day in
 * memory; an artist ListenBrainz does not know answers an empty list, which is cached too.
 */
export class ListenBrainz {
  private cache = new Map<string, { until: number; artists: SimilarArtist[] }>();
  constructor(private fetcher: typeof fetch = fetch) {}

  async similar(mbid: string): Promise<SimilarArtist[]> {
    const cached = this.cache.get(mbid);
    if (cached && cached.until > Date.now()) return cached.artists;
    const url = new URL("https://labs.api.listenbrainz.org/similar-artists/json");
    url.search = new URLSearchParams({ artist_mbids: mbid, algorithm: ALGORITHM }).toString();
    const response = await this.fetcher(url, {
      headers: { "User-Agent": "Sillage/2.2.0 (https://sillage.stoa.solutions)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`ListenBrainz indisponible (HTTP ${response.status}).`);
    const body = (await response.json()) as unknown;
    const rows = Array.isArray(body) ? body : [];
    const artists = rows
      .filter(
        (row): row is { artist_mbid: string; name: string; score?: number } =>
          typeof row?.artist_mbid === "string" && typeof row?.name === "string",
      )
      .map((row) => ({ mbid: row.artist_mbid, name: row.name, score: row.score ?? 0 }));
    if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(mbid, { until: Date.now() + DAY, artists });
    return artists;
  }
}

export const listenBrainz = new ListenBrainz();
