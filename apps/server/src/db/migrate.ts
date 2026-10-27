import { fileURLToPath } from "node:url";
import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/**
 * Applies the pending migrations of apps/server/drizzle in one transaction. The history lives
 * in the `drizzle` schema, or in a test suite's own schema so suites never share it.
 */
export async function migrate(db: Database) {
  await applyMigrations(db.orm, {
    migrationsFolder,
    migrationsSchema: db.schema === "public" ? "drizzle" : db.schema,
  });
}
