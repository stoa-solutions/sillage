import pg from "pg";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as tables from "./schema/index.ts";

export type Orm = NodePgDatabase<typeof tables>;
/** The database or an open transaction: store functions accept both. */
export type Executor = PgDatabase<
  NodePgQueryResultHKT,
  typeof tables,
  ExtractTablesWithRelations<typeof tables>
>;

/**
 * One PostgreSQL pool per process. Modules query it through `orm` (Drizzle); the pool itself
 * serves the migration lock and the test fixtures.
 */
export type Database = pg.Pool & {
  readonly orm: Orm;
  /** The PostgreSQL schema holding the tables: public, or a test suite's own schema. */
  readonly schema: string;
};

export interface DatabaseOptions {
  url: string;
  /** A schema other than public, for disposable test databases. */
  schema?: string;
}

export function openDatabase({
  url,
  schema = "public",
}: DatabaseOptions): Database {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid schema name");
  const pool = new pg.Pool({
    connectionString: url,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ...(schema === "public"
      ? {}
      : { options: `-c search_path=${schema},public` }),
  });
  return Object.assign(pool, { orm: drizzle(pool, { schema: tables }), schema });
}

export const pool = openDatabase({ url: process.env["DATABASE_URL"] ?? "" });
