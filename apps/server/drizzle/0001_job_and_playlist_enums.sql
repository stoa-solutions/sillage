-- Fixed values of the queue and of playlist synchronisation become enums. Defaults and the
-- partial indexes comparing these columns with text are rebuilt around the type change.
-- Types are created in the current schema (public in production, a suite's own schema in tests).
CREATE TYPE playlist_status AS ENUM('pending', 'syncing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE sync_run_status AS ENUM('running', 'done', 'error');--> statement-breakpoint
CREATE TYPE job_kind AS ENUM('sync', 'enrich', 'text', 'image', 'musicbrainz');--> statement-breakpoint
CREATE TYPE job_status AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
ALTER TABLE playlists ALTER COLUMN status DROP DEFAULT;--> statement-breakpoint
ALTER TABLE playlists ALTER COLUMN status SET DATA TYPE playlist_status USING status::playlist_status;--> statement-breakpoint
ALTER TABLE playlists ALTER COLUMN status SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE sync_runs ALTER COLUMN status DROP DEFAULT;--> statement-breakpoint
ALTER TABLE sync_runs ALTER COLUMN status SET DATA TYPE sync_run_status USING status::sync_run_status;--> statement-breakpoint
ALTER TABLE sync_runs ALTER COLUMN status SET DEFAULT 'running';--> statement-breakpoint
DROP INDEX jobs_active_key;--> statement-breakpoint
DROP INDEX jobs_musicbrainz_video;--> statement-breakpoint
ALTER TABLE jobs ALTER COLUMN status DROP DEFAULT;--> statement-breakpoint
ALTER TABLE jobs ALTER COLUMN kind SET DATA TYPE job_kind USING kind::job_kind;--> statement-breakpoint
ALTER TABLE jobs ALTER COLUMN status SET DATA TYPE job_status USING status::job_status;--> statement-breakpoint
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX jobs_active_key ON jobs (dedupe_key) WHERE status IN ('pending','running');--> statement-breakpoint
CREATE INDEX jobs_musicbrainz_video ON jobs ((payload->>'videoId'), created_at DESC, id DESC) WHERE kind='musicbrainz';
