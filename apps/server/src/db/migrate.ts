import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

/** Same key as the baseline's own lock, so the pre-Drizzle script and this one exclude each other. */
const MIGRATION_LOCK = 740071;

/** apps/server/drizzle, found from src/db in development or from a dist bundle in production. */
function migrationsFolder() {
  for (const up of ["../../drizzle", "../drizzle", "../../../drizzle"]) {
    const folder = fileURLToPath(new URL(up, import.meta.url));
    if (existsSync(`${folder}/meta/_journal.json`)) return folder;
  }
  throw new Error("Drizzle migrations folder not found");
}

/**
 * Applies the pending migrations of apps/server/drizzle in one transaction. The history lives
 * in the `drizzle` schema, or in a test suite's own schema so suites never share it.
 *
 * Drizzle creates and reads its history before opening its transaction: a lock taken inside a
 * migration would come too late for two processes starting together. The whole run therefore
 * holds a session advisory lock on one dedicated connection, which the migrator also uses.
 */
export async function migrate(db: Database) {
  const client = await db.connect();
  let healthy = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await applyMigrations(drizzle(client), {
        migrationsFolder: migrationsFolder(),
        migrationsSchema: db.schema === "public" ? "drizzle" : db.schema,
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
    healthy = true;
  } finally {
    // A connection whose unlock failed may still hold the lock: close it instead of reusing it.
    client.release(!healthy);
  }
}
