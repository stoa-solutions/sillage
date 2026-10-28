import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate, openDatabase } from "../src/db/index.ts";
import { hash } from "../src/content.ts";
import { createApp } from "../src/app.ts";
import { catalogArtists, type InsightsSources } from "../src/modules/insights/index.ts";
vi.mock("../src/integrations/inference/client.ts", () => ({ infer: vi.fn() }));
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const schema = "insights_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });

const calls: string[] = [];
let musicDown = false;
const summaries: Record<string, { description: string; extract: string }> = {
  "fr:Phoenix (groupe)": { description: "groupe de pop rock français", extract: "Phoenix est un groupe de pop rock français." },
  "fr:Phoenix (Arizona)": { description: "ville des États-Unis", extract: "Phoenix est la capitale de l’Arizona." },
  "fr:Nirvana (groupe)": { description: "groupe de grunge américain", extract: "Nirvana est un groupe de grunge." },
  "fr:Smells Like Teen Spirit": { description: "chanson de Nirvana", extract: "Smells Like Teen Spirit est une chanson de Nirvana." },
};
const sources: Partial<InsightsSources> = {
  music: {
    async artist(name) {
      calls.push(`music:${name}`);
      if (musicDown) throw new Error("YouTube Music indisponible");
      return name === "Phoenix"
        ? {
            browseId: "UCphoenix",
            name: "Phoenix",
            banner: "https://lh3.googleusercontent.com/banner=w2880-h1200",
            portrait: "https://lh3.googleusercontent.com/portrait=w544-h544",
            description: null,
            audience: "7,26 M auditeurs/mois",
            releases: [{ browseId: "MPREb_1", title: "Alpha Zulu", kind: "Album", year: "2022", artwork: null }],
            related: [{ name: "Air", portrait: null }],
          }
        : null;
    },
    async album(browseId) {
      calls.push(`album:${browseId}`);
      return browseId === "MPREb_bankrupt"
        ? {
            browseId,
            title: "Bankrupt!",
            artist: "Phoenix",
            kind: "Album",
            year: "2013",
            summary: "2 titres • 7 minutes",
            description: null,
            artwork: null,
            tracks: [
              { videoId: "tBsRvthVhdw", title: "Entertainment", position: 1, durationSeconds: 220, plays: "10 M lectures" },
              { videoId: "1FbJw2JetUo", title: "The Real Thing", position: 2, durationSeconds: 203, plays: null },
            ],
          }
        : null;
    },
    async searchArtists(query) {
      calls.push(`searchArtists:${query}`);
      return [{ browseId: "UCphoenix", name: "Phoenix", portrait: null, audience: "7,26 M auditeurs/mois" }];
    },
  },
  catalog: {
    async artist(name) {
      calls.push(`catalog:${name}`);
      return name === "Nirvana"
        ? {
            id: "5b11f4ce-a62d-471e-81fc-a69a8278c7da",
            type: "Group",
            area: "United States",
            beginArea: "Aberdeen",
            begin: "1987",
            end: "1994-04-05",
            genres: ["grunge", "rock", "alternative rock"],
            wikidata: "Q11649",
          }
        : null;
    },
  },
  wikipedia: {
    async summary(lang, title) {
      calls.push(`summary:${lang}:${title}`);
      const found = summaries[`${lang}:${title}`];
      return found ? { title, lang, image: null, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, ...found } : null;
    },
    async sitelinks(qid) {
      calls.push(`sitelinks:${qid}`);
      return qid === "Q11649" ? [{ lang: "fr", title: "Nirvana (groupe)" }] : [];
    },
    async search(lang, query) {
      calls.push(`search:${lang}:${query}`);
      if (lang !== "fr") return [];
      if (query === "Phoenix") return ["Phoenix (Arizona)", "Phoenix (groupe)"];
      if (query.includes("Smells Like Teen Spirit")) return ["Smells Like Teen Spirit"];
      return [];
    },
  },
  youtube: {
    async statistics(id) {
      calls.push(`statistics:${id}`);
      return { views: 1_900_000_000, likes: 12_000_000, comments: 640_000 };
    },
    async topComments(id) {
      calls.push(`comments:${id}`);
      return [{ author: "someone", text: "Toujours aussi fort.", likes: 4200, publishedAt: "2025-01-01T00:00:00Z" }];
    },
  },
};
const app = createApp(db, undefined, undefined, sources);
const token = "alice-insights-token-1234567890";
let alice = "";
const get = async (path: string) => {
  const response = await app.request(path, { headers: { Authorization: "Bearer " + token } });
  return { status: response.status, body: (await response.json()) as any };
};
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  calls.length = 0;
  musicDown = false;
  await db.query("TRUNCATE users,tokens,insights_cache,musicbrainz_cache,playlists,videos CASCADE");
  alice = randomUUID();
  await db.query(`INSERT INTO users(id,google_sub,email) VALUES($1,'g-alice','alice@example.test')`, [alice]);
  await db.query(`INSERT INTO tokens(id,name,hash,user_id) VALUES($1,'A',$2,$3)`, [randomUUID(), hash(token), alice]);
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("gathers an artist from YouTube Music and a checked Wikipedia search, then keeps it", async () => {
  const first = await get("/v1/insights/artist?name=Phoenix");
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    name: "Phoenix",
    banner: "https://lh3.googleusercontent.com/banner=w2880-h1200",
    audience: "7,26 M auditeurs/mois",
    // The city came first in the search; only the band is about music.
    description: "groupe de pop rock français",
    bio: { source: "Wikipedia", url: "https://fr.wikipedia.org/wiki/Phoenix%20(groupe)" },
    releases: [{ title: "Alpha Zulu" }],
    related: [{ name: "Air" }],
    links: { youtubeMusic: "https://music.youtube.com/channel/UCphoenix", musicbrainz: null },
    found: true,
  });
  calls.length = 0;
  expect((await get("/v1/insights/artist?name=phoenix")).body.name).toBe("Phoenix");
  expect(calls).toEqual([]);
});

it("follows MusicBrainz to Wikidata, and gives a band its years", async () => {
  const { body } = await get("/v1/insights/artist?name=Nirvana");
  expect(body).toMatchObject({
    kind: "Groupe",
    origin: "Aberdeen, United States",
    active: "1987 – 1994",
    genres: ["grunge", "rock", "alternative rock"],
    bio: { text: "Nirvana est un groupe de grunge." },
    links: { musicbrainz: "https://musicbrainz.org/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da" },
  });
  expect(calls).toContain("sitelinks:Q11649");
  expect(calls.some((call) => call.startsWith("search:"))).toBe(false);
});

it("does not keep a page built while a source failed", async () => {
  musicDown = true;
  expect((await get("/v1/insights/artist?name=Phoenix")).body).toMatchObject({ banner: null, found: true });
  musicDown = false;
  expect((await get("/v1/insights/artist?name=Phoenix")).body.banner).toContain("banner");
});

it("tells an unknown name apart, and keeps that answer too", async () => {
  expect((await get("/v1/insights/artist?name=Nobody%20Here")).body).toMatchObject({ found: false, bio: null });
  calls.length = 0;
  await get("/v1/insights/artist?name=Nobody%20Here");
  expect(calls).toEqual([]);
});

it("brings what people say of a video and its song's article, kept a day", async () => {
  const { status, body } = await get(
    "/v1/insights/video/hTWKbfoikeg?artist=Nirvana&title=Smells%20Like%20Teen%20Spirit",
  );
  expect(status).toBe(200);
  expect(body).toMatchObject({
    views: 1_900_000_000,
    likes: 12_000_000,
    commentCount: 640_000,
    comments: [{ author: "someone", likes: 4200 }],
    song: { title: "Smells Like Teen Spirit", description: "chanson de Nirvana" },
  });
  calls.length = 0;
  await get("/v1/insights/video/hTWKbfoikeg");
  expect(calls).toEqual([]);
  expect((await get("/v1/insights/video/too-short")).status).toBe(400);
});

it("asks MusicBrainz again once when it turns a request away", async () => {
  let answers = 0;
  const fetcher = (async (input: URL | RequestInfo) => {
    answers += 1;
    if (answers === 1) return new Response("busy", { status: 503 });
    return String(input).includes("/artist/")
      ? Response.json({ id: "id-1", type: "Person", area: { name: "United Kingdom" }, genres: [{ name: "nu jazz", count: 3 }] })
      : Response.json({ artists: [{ id: "id-1", name: "Alfa Mist", score: 100 }] });
  }) as typeof fetch;
  const found = await catalogArtists(db, fetcher, 0).artist("Alfa Mist");
  expect(found).toMatchObject({ id: "id-1", type: "Person", genres: ["nu jazz"] });
  expect(answers).toBe(3);
}, 15_000);

it("opens an album with the tracks the account already has, kept for everyone", async () => {
  await db.query(`INSERT INTO playlists(id,title,source_url) VALUES('PLalice12345','A','https://www.youtube.com/playlist?list=PLalice12345')`);
  await db.query(`INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLalice12345')`, [alice]);
  await db.query(
    `INSERT INTO videos(id,title,channel,duration_seconds,thumbnail_url,content_hash) VALUES('1FbJw2JetUo','The Real Thing','Phoenix - Topic',203,'https://i.ytimg.com/vi/1FbJw2JetUo/hqdefault.jpg','h1')`,
  );
  await db.query(`INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('1','PLalice12345','1FbJw2JetUo',1,1)`);
  const { status, body } = await get("/v1/insights/album/MPREb_bankrupt");
  expect(status).toBe(200);
  expect(body).toMatchObject({ title: "Bankrupt!", artist: "Phoenix", year: "2013" });
  expect(body.tracks.map((track: any) => [track.title, track.inLibrary])).toEqual([
    ["Entertainment", false],
    ["The Real Thing", true],
  ]);
  calls.length = 0;
  await get("/v1/insights/album/MPREb_bankrupt");
  expect(calls).toEqual([]);
  expect((await get("/v1/insights/album/MPREb_nothinghere")).status).toBe(404);
  expect((await get("/v1/insights/album/not-an-album")).status).toBe(400);
});

it("suggests artists for what is typed, once a day per query", async () => {
  expect((await get("/v1/insights/artists?query=phoe")).body.artists[0]).toMatchObject({ name: "Phoenix" });
  calls.length = 0;
  await get("/v1/insights/artists?query=Phoe");
  expect(calls).toEqual([]);
});
