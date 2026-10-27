import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

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
 */
export async function migrate(db: Database) {
  await applyMigrations(db.orm, {
    migrationsFolder: migrationsFolder(),
    migrationsSchema: db.schema === "public" ? "drizzle" : db.schema,
  });
}
