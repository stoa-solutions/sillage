-- Listening outcomes and stored lyrics statuses become enums; the outcome CHECK they replace
-- is dropped. Types are created in the current schema (see 0001).
CREATE TYPE listening_outcome AS ENUM('finished', 'skipped', 'unavailable', 'replaced');--> statement-breakpoint
CREATE TYPE lyrics_status AS ENUM('synced', 'plain', 'instrumental', 'missing');--> statement-breakpoint
ALTER TABLE listening_history DROP CONSTRAINT listening_history_outcome_check;--> statement-breakpoint
ALTER TABLE listening_history ALTER COLUMN outcome SET DATA TYPE listening_outcome USING outcome::listening_outcome;--> statement-breakpoint
ALTER TABLE lyrics ALTER COLUMN status SET DATA TYPE lyrics_status USING status::lyrics_status;
