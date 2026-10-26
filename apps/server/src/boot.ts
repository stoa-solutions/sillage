import { pool } from "./db.ts";
import { migrate } from "./migrate.ts";
import { closeInterruptedTurns } from "./features/dj/journal/store.ts";
await migrate(pool);
// A single API process owns every DJ turn: anything still running was cut by a restart.
await closeInterruptedTurns(pool);
await import("./main.ts");
