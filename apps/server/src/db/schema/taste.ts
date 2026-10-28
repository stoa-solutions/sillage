import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";
import { users } from "./accounts.ts";

export const tasteValue = pgEnum("taste_value", ["like", "dislike"]);

/**
 * The listener's 👍 / 👎 on a track. One row per track: a new opinion replaces the old one,
 * and withdrawing it deletes the row. No foreign key to videos: YouTube tracks may be unsaved.
 */
export const trackFeedback = pgTable(
  "track_feedback",
  {
    userId: uuid("user_id").notNull(),
    videoId: text("video_id").notNull(),
    value: tasteValue("value").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "track_feedback_pkey", columns: [t.userId, t.videoId] }),
    foreignKey({
      name: "track_feedback_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check("track_feedback_video_id_check", sql`${t.videoId} ~ '^[A-Za-z0-9_-]{11}$'`),
  ],
);

/** Per-account taste settings; an account without a row uses the defaults of taste.rules.ts. */
export const tasteSettings = pgTable(
  "taste_settings",
  {
    userId: uuid("user_id").primaryKey(),
    dislikeDays: smallint("dislike_days").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "taste_settings_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check("taste_settings_dislike_days_check", sql`${t.dislikeDays} BETWEEN 1 AND 60`),
  ],
);
