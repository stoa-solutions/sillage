import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";

/** Worker queue leased with row locks: at most one pending or running job per dedupe key. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamptz("available_at").notNull().defaultNow(),
    leaseUntil: timestamptz("lease_until"),
    leaseId: uuid("lease_id"),
    error: text("error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    completedAt: timestamptz("completed_at"),
  },
  (t) => [
    uniqueIndex("jobs_active_key")
      .on(t.dedupeKey)
      .where(sql`status IN ('pending','running')`),
    index("jobs_due").on(t.status, t.availableAt),
    // Bounded account progress polling must not scan historical jobs per video.
    index("jobs_musicbrainz_video")
      .on(sql`(payload->>'videoId')`, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`kind='musicbrainz'`),
  ],
);

/** YouTube Data API units spent per day. */
export const quotaUsage = pgTable("quota_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  units: integer("units").notNull().default(0),
});
