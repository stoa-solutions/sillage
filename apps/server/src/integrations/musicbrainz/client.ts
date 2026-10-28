import { setTimeout as delay } from "node:timers/promises";
import { and, eq, gt, sql } from "drizzle-orm";
import { musicbrainzCache, type Database } from "../../db/index.ts";

/** Shared response cache and rate gate: all workers together stay below one request/second. */
export class MusicBrainzClient {
  constructor(
    private db: Database,
    private fetcher: typeof fetch = fetch,
  ) {}
  private url(path: string, params: Record<string, string>) {
    const url = new URL(`https://musicbrainz.org/ws/2/${path}`);
    url.search = new URLSearchParams({ ...params, fmt: "json" }).toString();
    return url;
  }
  /** Whether this request is answered from the cache, without waiting for the rate gate. */
  async cached(path: string, params: Record<string, string> = {}) {
    const [row] = await this.db.orm
      .select({ url: musicbrainzCache.url })
      .from(musicbrainzCache)
      .where(
        and(
          eq(musicbrainzCache.url, this.url(path, params).href),
          gt(musicbrainzCache.fetchedAt, sql`now() - interval '30 days'`),
        ),
      );
    return !!row;
  }
  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = this.url(path, params);
    return this.db.orm.transaction(async (tx) => {
      // One request at a time across every worker: the lock is held until the cache write.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(740073)`);
      const [cached] = await tx
        .select({ response: musicbrainzCache.response })
        .from(musicbrainzCache)
        .where(
          and(
            eq(musicbrainzCache.url, url.href),
            gt(musicbrainzCache.fetchedAt, sql`now() - interval '30 days'`),
          ),
        );
      if (cached) return cached.response as T;
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            "User-Agent":
              "Sillage/1.5.4 (https://sillage.stoa.solutions)",
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
      await tx
        .insert(musicbrainzCache)
        .values({ url: url.href, response: data })
        .onConflictDoUpdate({
          target: musicbrainzCache.url,
          set: { response: data, fetchedAt: sql`now()` },
        });
      return data;
    });
  }
}
