/** The opening of a Wikipedia article: what an encyclopedia says first, with its picture. */
export interface WikiSummary {
  title: string;
  /** One line under the title, e.g. « groupe de rock américain ». */
  description: string | null;
  extract: string;
  image: string | null;
  url: string;
  lang: string;
}

const AGENT = "Sillage/2.2 (https://sillage.stoa.solutions)";

/**
 * Wikipedia's public REST and search APIs, French first then English. Keyless; every answer
 * is kept by the caller.
 */
export class Wikipedia {
  /** Without a fetcher, the global one at call time. */
  constructor(private fetcher?: typeof fetch) {}

  private async json(url: URL): Promise<any> {
    const response = await (this.fetcher ?? fetch)(url, {
      headers: { "User-Agent": AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Wikipedia indisponible (HTTP ${response.status}).`);
    return response.json();
  }

  /** An article's summary, or null when it is missing or only a disambiguation page. */
  async summary(lang: string, title: string): Promise<WikiSummary | null> {
    const body = await this.json(
      new URL(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`),
    );
    if (!body || body.type !== "standard" || !body.extract) return null;
    return {
      title: body.title,
      description: body.description ?? null,
      extract: body.extract,
      image: body.originalimage?.source ?? body.thumbnail?.source ?? null,
      url: body.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      lang,
    };
  }

  /** The French then English articles a Wikidata item links to. */
  async sitelinks(qid: string): Promise<{ lang: string; title: string }[]> {
    if (!/^Q\d+$/.test(qid)) return [];
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({
      action: "wbgetentities",
      ids: qid,
      props: "sitelinks",
      sitefilter: "frwiki|enwiki",
      format: "json",
    }).toString();
    const links = (await this.json(url))?.entities?.[qid]?.sitelinks ?? {};
    return ["fr", "en"].flatMap((lang) => {
      const title = links[`${lang}wiki`]?.title;
      return typeof title === "string" ? [{ lang, title }] : [];
    });
  }

  /** Article titles for a free-text query, best first. */
  async search(lang: string, query: string, limit = 3): Promise<string[]> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(limit),
      format: "json",
    }).toString();
    return ((await this.json(url))?.query?.search ?? []).map((hit: { title: string }) => hit.title);
  }
}

export const wikipedia = new Wikipedia();
