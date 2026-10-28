-- Lyrics from several sources, for any YouTube video: a discovery played outside the library
-- keeps its lyrics too. The name of the source is kept; LRCLIB rows from before stay null.
ALTER TABLE "lyrics" DROP CONSTRAINT "lyrics_video_id_fkey";
--> statement-breakpoint
ALTER TABLE "lyrics" ADD COLUMN "source_name" text;--> statement-breakpoint
ALTER TABLE "lyrics" ADD CONSTRAINT "lyrics_video_id_check" CHECK ("lyrics"."video_id" ~ '^[A-Za-z0-9_-]{11}$');