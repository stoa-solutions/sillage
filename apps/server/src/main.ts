import { serve } from "@hono/node-server";
import { pool } from "./db/index.ts";
import { createApp } from "./app.ts";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const server = serve({
  fetch: createApp(pool).fetch,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3001),
});
process.on("SIGTERM", () => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
});
