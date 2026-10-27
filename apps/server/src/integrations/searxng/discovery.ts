import { z } from "zod";
import type { YouTube } from "../youtube/index.ts";

import { SearxngError } from "./errors.ts";
import { boundedJson } from "./client.ts";

const responseSchema = z.object({
  results: z.array(z.object({ url: z.string() })).max(200),
  unresponsive_engines: z.array(z.tuple([z.string(), z.string()])).default([]),
});

/** Extract identifiers only: provider URLs never become network destinations. */
export function youtubeResultId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return;
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : [
              "www.youtube.com",
              "youtube.com",
              "m.youtube.com",
              "music.youtube.com",
            ].includes(url.hostname) && url.pathname === "/watch"
          ? url.searchParams.get("v")
          : undefined;
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch {
    return;
  }
}

/** SearXNG discovers IDs; the official metadata endpoint remains authoritative. */
export class SearxngDiscovery {
  constructor(
    private baseUrl: string,
    private youtube: Pick<YouTube, "videos">,
    private request: typeof fetch = fetch,
  ) {}

  videos(ids: string[]) {
    return this.youtube.videos(ids, true);
  }

  async search(query: string, pageToken = "") {
    // SearXNG's JSON API does not expose YouTube's continuation cursor.
    // Never pretend page 2 exists: it would repeat the first page.
    if (pageToken) throw new SearxngError();
    let ids: string[];
    try {
      const url = new URL("/search", this.baseUrl);
      url.search = new URLSearchParams({
        q: "!yt " + query.replace(/(^|\s)![^\s]+/g, " "),
        format: "json",
        engines: "youtube",
        categories: "videos",
        safesearch: "0",
        language: "all",
      }).toString();
      const response = await this.request(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new SearxngError(
          [403, 429].includes(response.status)
            ? "search_blocked"
            : "search_unavailable",
        );
      const data = responseSchema.parse(await boundedJson(response));
      if (data.unresponsive_engines.length) {
        const blocked = data.unresponsive_engines.some(([, reason]) =>
          /captcha|too many requests|access denied/i.test(reason),
        );
        throw new SearxngError(
          blocked ? "search_blocked" : "search_unavailable",
        );
      }
      ids = [
        ...new Set(
          data.results.flatMap((row) => youtubeResultId(row.url) ?? []),
        ),
      ].slice(0, 50);
      if (data.results.length && !ids.length) throw new SearxngError();
    } catch (error) {
      throw error instanceof SearxngError ? error : new SearxngError();
    }
    // Keep Google metadata failures distinct from failures of the search engine.
    const videos = await this.youtube.videos(ids, true, true);
    const byId = new Map(videos.map((video) => [video.id, video]));
    return {
      videos: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      nextPageToken: null,
    };
  }
}
