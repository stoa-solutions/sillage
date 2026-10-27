import { customType, timestamp } from "drizzle-orm/pg-core";

/** timestamptz read as a Date. */
export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** PostgreSQL full-text document; only ever produced by generated columns. */
export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** The account of the library from before accounts existed. */
export const LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001";
