import { pool } from "./db.ts";
import { migrate } from "./migrate.ts";
import { closeInterruptedTurns } from "./features/dj/journal/store.ts";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
await migrate({ url: process.env.DATABASE_URL });
// A single API process owns every DJ turn: anything still running was cut by a restart.
await closeInterruptedTurns(pool);
await import("./main.ts");
