import { afterAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate, openDatabase, type Database } from "../src/db/index.ts";
import { enqueue } from "../src/modules/jobs/index.ts";
import { replayBaseline } from "./support/database.ts";

const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable _test database required");
const admin = new pg.Pool({ connectionString: url });
const opened: Database[] = [];
const journal = JSON.parse(
  await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: unknown[] };

/** A fresh schema and two independent pools on it, like two API processes starting. */
async function twoProcesses(schema: string) {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const first = openDatabase({ url: url!, schema });
  const second = openDatabase({ url: url!, schema });
  opened.push(first, second);
  return [first, second] as const;
}
const applied = async (db: Database) =>
  Number(
    (await db.query(`SELECT count(*) FROM ${db.schema}.__drizzle_migrations`))
      .rows[0].count,
  );

afterAll(async () => {
  for (const db of opened) await db.end();
  for (const schema of ["migrate_fresh_test", "migrate_legacy_test"])
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

it("installs a new database once when two processes migrate together", async () => {
  const [first, second] = await twoProcesses("migrate_fresh_test");
  await Promise.all([migrate(first), migrate(second)]);
  expect(await applied(first)).toBe(journal.entries.length);
  await migrate(first);
  expect(await applied(first)).toBe(journal.entries.length);
  const types = await first.query(
    "SELECT typname FROM pg_type WHERE typnamespace=$1::regnamespace ORDER BY 1",
    [first.schema],
  );
  expect(types.rows.map((row) => row.typname)).toEqual(
    expect.arrayContaining(["job_kind", "job_status", "playlist_status"]),
  );
});

it("adopts a pre-Drizzle database with its data, even with concurrent migrators", async () => {
  const [first, second] = await twoProcesses("migrate_legacy_test");
  // The schema exactly as the pre-Drizzle script left it, with rows in every converted column.
  await replayBaseline(first);
  await first.query(`
    INSERT INTO playlists(id,title,source_url,status) VALUES('PL1','A','x','ready'),('PL2','B','x','error');
    INSERT INTO sync_runs(id,playlist_id,status) VALUES(gen_random_uuid(),'PL1','done');
    INSERT INTO jobs(id,kind,dedupe_key,payload,status) VALUES
      (gen_random_uuid(),'sync','sync:PL1','{"playlistId":"PL1"}','pending'),
      (gen_random_uuid(),'musicbrainz','musicbrainz:v','{"videoId":"abcdefghijk"}','failed');
    INSERT INTO users(id) VALUES('11111111-1111-4111-8111-111111111111');
    INSERT INTO listening_history(user_id,event_id,video_id,title,outcome,played_at) VALUES
      ('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'abcdefghijk','A','skipped',now());
    INSERT INTO videos(id,thumbnail_url,content_hash) VALUES('abcdefghijk','x','h');
    INSERT INTO lyrics(video_id,status) VALUES('abcdefghijk','missing');
  `);
  await Promise.all([migrate(first), migrate(second)]);
  expect(await applied(first)).toBe(journal.entries.length);
  const jobs = await first.query(
    "SELECT kind::text, status::text, pg_typeof(status)::text AS type FROM jobs ORDER BY kind",
  );
  expect(jobs.rows).toEqual([
    { kind: "musicbrainz", status: "failed", type: "job_status" },
    { kind: "sync", status: "pending", type: "job_status" },
  ]);
  const playlists = await first.query(
    "SELECT id, status::text FROM playlists ORDER BY id",
  );
  expect(playlists.rows).toEqual([
    { id: "PL1", status: "ready" },
    { id: "PL2", status: "error" },
  ]);
  const converted = await first.query(
    "SELECT (SELECT pg_typeof(outcome)::text FROM listening_history) AS outcome, (SELECT status::text FROM lyrics) AS lyrics",
  );
  expect(converted.rows[0]).toEqual({ outcome: "listening_outcome", lyrics: "missing" });
  // The rebuilt partial index still deduplicates active jobs.
  const again = await enqueue(first.orm, "sync", "PL1", { playlistId: "PL1" });
  expect(
    Number((await first.query("SELECT count(*) FROM jobs WHERE kind='sync'")).rows[0].count),
  ).toBe(1);
  expect(again.status).toBe("pending");
});
