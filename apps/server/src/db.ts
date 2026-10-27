import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

/**
 * One PostgreSQL pool per process, shared by Prisma and by the features that still issue SQL
 * through `query` while they move to Prisma. New code uses `db.prisma` only.
 */
export type Database = pg.Pool & { readonly prisma: PrismaClient };
export type Prisma = PrismaClient;

export interface DatabaseOptions {
  url: string;
  /** A PostgreSQL schema other than public, for disposable test databases. */
  schema?: string;
}

export function openDatabase({ url, schema }: DatabaseOptions): Database {
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid schema name");
  const pool = new pg.Pool({
    connectionString: url,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, schema ? { schema } : undefined),
  });
  return Object.assign(pool, { prisma });
}

export const pool = openDatabase({ url: process.env.DATABASE_URL ?? "" });

export async function transaction<T>(
  db: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
