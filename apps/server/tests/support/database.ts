import { readFile } from "node:fs/promises";
import type pg from "pg";

const baseline = new URL(
  "../../prisma/migrations/0_init/migration.sql",
  import.meta.url,
);

/** Runs the baseline again on a database that already has it: what a pre-Prisma production
 * database goes through when it adopts Prisma migrations. */
export async function replayBaseline(db: pg.Pool) {
  await db.query(await readFile(baseline, "utf8"));
}
