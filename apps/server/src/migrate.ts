import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import type { DatabaseOptions } from "./db.ts";

const run = promisify(execFile);
const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = "0_init";

/**
 * Applies pending migrations of prisma/migrations with `prisma migrate deploy`.
 *
 * A database created before Prisma has the baseline's tables but no migration history, which
 * Prisma refuses (P3005). Such a database first replays the idempotent baseline, which brings
 * it to the last pre-Prisma version, and records it as applied.
 */
export async function migrate({ url, schema = "public" }: DatabaseOptions) {
  const target = new URL(url);
  target.searchParams.set("schema", schema);
  const prisma = (...args: string[]) =>
    run(process.execPath, [cli, ...args], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: target.toString() },
    });
  if (await adoptsPrisma(url, schema)) {
    await prisma("migrate", "resolve", "--applied", BASELINE);
  }
  await prisma("migrate", "deploy");
}

async function adoptsPrisma(url: string, schema: string) {
  const client = new pg.Client({
    connectionString: url,
    options: `-c search_path=${schema},public`,
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ legacy: boolean; prisma: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS legacy, to_regclass($2) IS NOT NULL AS prisma`,
      [`${schema}.schema_migrations`, `${schema}._prisma_migrations`],
    );
    if (!rows[0]?.legacy || rows[0].prisma) return false;
    const baseline = new URL(
      `../prisma/migrations/${BASELINE}/migration.sql`,
      import.meta.url,
    );
    await client.query(await readFile(baseline, "utf8"));
    return true;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await migrate({ url: process.env.DATABASE_URL });
  console.log("Migrations applied.");
}
