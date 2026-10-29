import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` needs no database; it diffs src/db/schema.ts against the last snapshot.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(process.env["DATABASE_URL"]
    ? { dbCredentials: { url: process.env["DATABASE_URL"] } }
    : {}),
});
