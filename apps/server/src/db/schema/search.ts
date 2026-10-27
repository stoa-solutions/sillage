import {
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  vector,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";
import { videos } from "./library.ts";

/** Text chunks of a video with their E5 embedding. */
export const passages = pgTable(
  "passages",
  {
    videoId: text("video_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    sourceHash: text("source_hash").notNull(),
    modelKey: text("model_key").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
  },
  (t) => [
    primaryKey({ name: "passages_pkey", columns: [t.videoId, t.ordinal] }),
    foreignKey({
      name: "passages_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);

/** Thumbnail embedding of a video. */
export const images = pgTable(
  "images",
  {
    videoId: text("video_id").primaryKey(),
    sourceHash: text("source_hash").notNull(),
    sourceUrl: text("source_url").notNull(),
    modelKey: text("model_key").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    indexedAt: timestamptz("indexed_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "images_video_id_fkey",
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
  ],
);
