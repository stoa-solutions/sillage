import { readFile } from "node:fs/promises";
import { pool, transaction, type Database } from "./db.ts";
export async function migrate(db: Database) {
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740071)");
    await client.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate(pool);
  await pool.end();
  console.log("Migrations applied.");
}
