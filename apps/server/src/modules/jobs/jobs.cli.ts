import { pool } from "../../db/index.ts";
import { retryFailed } from "./jobs.repository.ts";

/** Queue maintenance from inside the worker or API container: `retry` requeues the last failures. */
const [action] = process.argv.slice(2);
try {
  if (action === "retry")
    console.log(`${await retryFailed(pool.orm)} tâche(s) relancée(s).`);
  else throw new Error("Usage: jobs.cli.ts retry");
} finally {
  await pool.end();
}
