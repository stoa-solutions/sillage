import { checkEnvironment } from "./config.ts";
import { migrate, pool } from "./db/index.ts";

// `npm run migrate`: what the API does at boot, without starting it.
checkEnvironment("migrate");
try {
  await migrate(pool);
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
