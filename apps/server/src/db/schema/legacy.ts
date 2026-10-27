import { integer, pgTable } from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";

/** Versions applied by the migration script used before Drizzle; read by the 0000 baseline. */
export const schemaMigrations = pgTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: timestamptz("applied_at").notNull().defaultNow(),
});
