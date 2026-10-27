import { setTimeout as delay } from "node:timers/promises";
import { transaction, type Database } from "../db/index.ts";

/** Shared response cache and rate gate: all workers together stay below one request/second. */
export class MusicBrainzClient {
  constructor(
    private db: Database,
    private fetcher: typeof fetch = fetch,
  ) {}
  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://musicbrainz.org/ws/2/${path}`);
    url.search = new URLSearchParams({ ...params, fmt: "json" }).toString();
    return transaction(this.db, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(740073)");
      const cached = await client.query(
        "SELECT response FROM musicbrainz_cache WHERE url=$1 AND fetched_at>now()-interval '30 days'",
        [url.href],
      );
      if (cached.rows.length) return cached.rows[0].response as T;
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            "User-Agent":
              "PlaylistRecall/1.5.4 (https://recall.stoa.solutions)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        });
      } finally {
        await delay(1100);
      }
      // Wait even on a rejected request, before the transaction releases the shared gate.
      if (!response.ok)
        throw new Error(
          `MusicBrainz indisponible (HTTP ${response.status}). Réessai différé.`,
        );
      const data = (await response.json()) as T;
      await client.query(
        "INSERT INTO musicbrainz_cache(url,response) VALUES($1,$2) ON CONFLICT(url) DO UPDATE SET response=excluded.response,fetched_at=now()",
        [url.href, JSON.stringify(data)],
      );
      return data;
    });
  }
}
