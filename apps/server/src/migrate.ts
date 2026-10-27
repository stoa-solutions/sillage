import { migrate, pool } from "./db/index.ts";

// `npm run migrate`: what the API does at boot, without starting it.
if (!process.env["DATABASE_URL"]) throw new Error("DATABASE_URL is required");
try {
  await migrate(pool);
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
