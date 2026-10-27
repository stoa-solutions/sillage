import { checkEnvironment } from "./config.ts";
import { migrate, pool } from "./db/index.ts";
import { closeInterruptedTurns } from "./modules/dj/index.ts";
checkEnvironment("api");
await migrate(pool);
// A single API process owns every DJ turn: anything still running was cut by a restart.
await closeInterruptedTurns(pool);
await import("./main.ts");
