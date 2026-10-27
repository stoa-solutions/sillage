import { migrate } from "./migrate.ts";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
// Migrate before loading the server and Prisma Client: the Prisma CLI runs in a child process
// and both must fit in the API's memory limit.
await migrate({ url: process.env.DATABASE_URL });
const { pool } = await import("./db.ts");
const { closeInterruptedTurns } = await import(
  "./features/dj/journal/store.ts"
);
// A single API process owns every DJ turn: anything still running was cut by a restart.
await closeInterruptedTurns(pool);
await import("./main.ts");
