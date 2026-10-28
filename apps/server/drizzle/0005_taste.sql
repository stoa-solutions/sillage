-- Taste: the listener's 👍 / 👎 per track, the per-account settings, and how long each play
-- lasted. Types and references stay unqualified: each test suite has its own schema (see 0001).
CREATE TYPE "taste_value" AS ENUM('like', 'dislike');--> statement-breakpoint
CREATE TABLE "taste_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"dislike_days" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taste_settings_dislike_days_check" CHECK ("taste_settings"."dislike_days" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "track_feedback" (
	"user_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"value" "taste_value" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_feedback_pkey" PRIMARY KEY("user_id","video_id"),
	CONSTRAINT "track_feedback_video_id_check" CHECK ("track_feedback"."video_id" ~ '^[A-Za-z0-9_-]{11}$')
);
--> statement-breakpoint
ALTER TABLE "listening_history" ADD COLUMN "listened_ms" integer;--> statement-breakpoint
ALTER TABLE "taste_settings" ADD CONSTRAINT "taste_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_feedback" ADD CONSTRAINT "track_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listening_history_video" ON "listening_history" USING btree ("user_id","video_id");--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_listened_ms_check" CHECK ("listening_history"."listened_ms" IS NULL OR "listening_history"."listened_ms" >= 0);