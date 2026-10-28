CREATE TABLE "insights_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
