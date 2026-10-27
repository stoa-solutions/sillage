import { migrate, pool } from "./db/index.ts";
import { closeInterruptedTurns } from "./modules/dj/journal/store.ts";
if (!process.env["DATABASE_URL"]) throw new Error("DATABASE_URL is required");
await migrate(pool);
// A single API process owns every DJ turn: anything still running was cut by a restart.
await closeInterruptedTurns(pool);
await import("./main.ts");
