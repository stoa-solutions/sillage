import { readFile } from "node:fs/promises";
import type pg from "pg";

const baseline = new URL(
  "../../drizzle/0000_baseline.sql",
  import.meta.url,
);

/** Runs the baseline again on a database that already has it: what a pre-Drizzle production
 * database goes through when it adopts Drizzle migrations. */
export async function replayBaseline(db: pg.Pool) {
  await db.query(await readFile(baseline, "utf8"));
}
