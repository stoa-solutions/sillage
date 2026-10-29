import { checkEnvironment } from "./shared/config.ts";
import { migrate, pool } from "./db/index.ts";
import { syncBaseAgents } from "./modules/dj-agents/index.ts";
import { logger } from "./shared/logger.ts";

// `npm run migrate`: what the API does at boot, without starting it.
checkEnvironment("migrate");
try {
  await migrate(pool);
  await syncBaseAgents(pool);
  logger.info("Migrations applied, base DJ agents written");
} finally {
  await pool.end();
}
