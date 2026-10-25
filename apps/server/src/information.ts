import { z } from "zod";
import { boundedJson } from "./searxng-client.ts";

export interface InformationSource {
  id: number;
  title: string;
  url: string;
  snippet: string;
}
const responseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string().default(""),
      }),
    )
    .max(200),
  unresponsive_engines: z.array(z.tuple([z.string(), z.string()])).default([]),
});
const clean = (text: string, limit: number) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
export function publicSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    // Links are displayed, never fetched. Keep local/private addresses out of source cards.
    if (
      !url.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        url.hostname,
      ) ||
      url.hostname.endsWith(".local")
    )
      return;
    url.hash = "";
    return url.toString();
  } catch {
    return;
  }
}

interface InformationResult {
  sources: InformationSource[];
}

/** Public web snippets only, never full chat history or account data. No page-fetch tool. */
export class InformationSearch {
  private cache = new Map<string, { until: number; data: InformationResult }>();
  private pending = new Map<string, Promise<InformationResult>>();
  constructor(
    private url: string,
    private request: typeof fetch = fetch,
  ) {}
  async search(query: string) {
    const key = query.toLocaleLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now())
      return { ...cached.data, status: "ok" as const };
    if (!this.url) return { sources: [], status: "unavailable" as const };
    try {
      let pending = this.pending.get(key);
      if (!pending) {
        if (this.pending.size >= 4)
          return { sources: [], status: "unavailable" as const };
        pending = this.lookup(query);
        this.pending.set(key, pending);
      }
      const data = await pending;
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + 600_000, data });
      return { ...data, status: "ok" as const };
    } catch {
      return { sources: [], status: "unavailable" as const };
    } finally {
      this.pending.delete(key);
    }
  }
  private async lookup(query: string): Promise<InformationResult> {
    const url = new URL("/search", this.url);
    url.search = new URLSearchParams({
      q: "!go !ddg " + query.replace(/(^|\s)![^\s]+/g, " "),
      format: "json",

      language: "fr-FR",
    }).toString();
    const response = await this.request(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("information unavailable");
    const data = responseSchema.parse(await boundedJson(response));
    if (!data.results.length && data.unresponsive_engines.length)
      throw new Error("information unavailable");
    const seen = new Set<string>();
    const sources: InformationSource[] = [];
    for (const row of data.results) {
      const url = publicSourceUrl(row.url);
      const title = clean(row.title, 220),
        snippet = clean(row.content, 700);
      if (!url || !title || !snippet || seen.has(url)) continue;
      seen.add(url);
      sources.push({ id: sources.length + 1, title, url, snippet });
      if (sources.length >= 5) break;
    }
    return {
      sources,
    };
  }
}
let service: InformationSearch | undefined;
export function informationSearch() {
  return (service ??= new InformationSearch(process.env.SEARXNG_URL ?? ""));
}
