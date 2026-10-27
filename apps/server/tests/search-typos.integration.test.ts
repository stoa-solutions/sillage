import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../src/db/index.ts";
import { search } from "../src/modules/search/index.ts";
import { infer } from "../src/integrations/inference/index.ts";

vi.mock("../src/integrations/inference/client.ts", () => ({ infer: vi.fn().mockRejectedValue(new Error("No inference in lexical regression")) }));
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Disposable _test database required");
const schema = "search_typos_test";
const admin = new pg.Pool({ connectionString: url });
const db = openDatabase({ url, schema });
const alice = randomUUID(), bob = randomUUID();
const id = "TRwTWnarBtE";
const input = (query: string, extra = {}) => ({ query, mode: "text" as const, sort: "relevance" as const, offset: 0, limit: 20, availableOnly: true, ...extra });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  await db.query("INSERT INTO users(id) VALUES($1),($2)", [alice, bob]);
  await db.query("INSERT INTO playlists(id,title,source_url) VALUES('PLtypoAlice','Test','https://youtube.com/playlist?list=PLtypoAlice')");
  await db.query("INSERT INTO user_playlists(user_id,playlist_id) VALUES($1,'PLtypoAlice')", [alice]);
  await db.query("INSERT INTO videos(id,title,channel,thumbnail_url,content_hash,music_metadata) VALUES($1,'basqany :(','Ayau','https://i.ytimg.com/vi/TRwTWnarBtE/hqdefault.jpg','fixture',$2)", [id, {
    status: "matched", searchText: "basqany Ayau Shiza M’Dee", artists: [{ name: "M’Dee" }],
  }]);
  await db.query("INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('typo','PLtypoAlice',$1,1,1)", [id]);
  // An exact artist/title hit must not hide a collaboration indexed as metadata.
  await db.query("INSERT INTO videos(id,title,channel,thumbnail_url,content_hash) VALUES('0VyNRvcx8Q4','M''Dee - Север','M''Dee','https://i.ytimg.com/vi/0VyNRvcx8Q4/hqdefault.jpg','fixture')");
  await db.query("INSERT INTO memberships(key,playlist_id,video_id,position,seen_generation) VALUES('artist','PLtypoAlice','0VyNRvcx8Q4',2,1)");
});
beforeEach(() => { vi.mocked(infer).mockClear(); });
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it.each(["basquany", "baqsany", "Madee basquany", "M Dee basquany"])(
  "retrieves %s lexically, including accepted collaborator credits, without vectors", async query => {
    const result = await search(db, input(query), alice);
    expect(result.results.map(r => r.video.id)).toEqual([id]);
    expect(infer).not.toHaveBeenCalled();
    expect(result.degraded).toBeNull();
  },
);
it.each(["MDee", "M’Dee", "M'Dee", "M Dee"])(
  "finds both an artist title and a credited collaboration for %s", async query => {
    const result = await search(db, input(query), alice);
    expect(result.results.map(r => r.video.id).sort()).toEqual(["0VyNRvcx8Q4", id].sort());
    expect(infer).not.toHaveBeenCalled();
  },
);
it("retains account, playlist and explicit exclusion filters during typo expansion", async () => {
  for (const [owner, extra] of [[bob, {}], [alice, { playlistId: "PLnotOwned" }], [alice, { excludeIds: [id] }]] as const) {
    const result = await search(db, input("basquany", extra), owner);
    expect(result.results).toEqual([]);
  }
});
it("does not turn a distant or contradictory lookup into a match", async () => {
  for (const query of ["basquany missingartist", "xbasquanny", "zzzxqv"]) {
    expect((await search(db, input(query), alice)).results).toEqual([]);
  }
});
