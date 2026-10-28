/** lyrics.ovh: free, keyless, plain lyrics by artist and title; often empty for niche artists. */
export class LyricsOvh {
  /** Without a fetcher, the global one at call time. */
  constructor(private fetcher?: typeof fetch) {}

  async lyrics(artist: string, title: string): Promise<string | null> {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const response = await (this.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`lyrics.ovh indisponible (HTTP ${response.status}).`);
    const body = (await response.json()) as { lyrics?: unknown };
    const text = typeof body.lyrics === "string" ? body.lyrics.replace(/\r\n/g, "\n").trim() : "";
    return text || null;
  }
}

export const lyricsOvh = new LyricsOvh();
