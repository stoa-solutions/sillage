import { pool } from "./db.ts";
import { migrate } from "./migrate.ts";
await migrate(pool);
await import("./main.ts");
