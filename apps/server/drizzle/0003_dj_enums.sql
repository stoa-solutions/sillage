-- DJ values become enums and replace their CHECK constraints: discovery scope, turn trigger
-- and status, journal origin, AI provider (credentials) and the account's DJ provider.
-- Constraints are dropped IF EXISTS: the baseline adds the status check only when no schema
-- of the database has it yet. Defaults are rebuilt around the type change; types live in the
-- current schema (see 0001).
CREATE TYPE ai_provider AS ENUM('google', 'anthropic');--> statement-breakpoint
CREATE TYPE user_dj_provider AS ENUM('google', 'anthropic', 'legacy');--> statement-breakpoint
CREATE TYPE discovery_scope AS ENUM('library', 'youtube', 'all');--> statement-breakpoint
CREATE TYPE journal_origin AS ENUM('client', 'server');--> statement-breakpoint
CREATE TYPE turn_status AS ENUM('running', 'completed', 'error', 'canceled', 'busy', 'superseded', 'interrupted');--> statement-breakpoint
CREATE TYPE turn_trigger AS ENUM('user', 'continuation');--> statement-breakpoint
ALTER TABLE account_ai_credentials DROP CONSTRAINT IF EXISTS account_ai_credentials_provider_check;--> statement-breakpoint
ALTER TABLE dj_journal_events DROP CONSTRAINT IF EXISTS dj_journal_events_scope_check;--> statement-breakpoint
ALTER TABLE dj_journal_events DROP CONSTRAINT IF EXISTS dj_journal_events_origin_check;--> statement-breakpoint
ALTER TABLE dj_turns DROP CONSTRAINT IF EXISTS dj_turns_scope_check;--> statement-breakpoint
ALTER TABLE dj_turns DROP CONSTRAINT IF EXISTS dj_turns_requested_scope_check;--> statement-breakpoint
ALTER TABLE dj_turns DROP CONSTRAINT IF EXISTS dj_turns_trigger_check;--> statement-breakpoint
ALTER TABLE dj_turns DROP CONSTRAINT IF EXISTS dj_turns_status_check;--> statement-breakpoint
ALTER TABLE account_ai_credentials ALTER COLUMN provider SET DATA TYPE ai_provider USING provider::ai_provider;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN dj_provider DROP DEFAULT;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN dj_provider SET DATA TYPE user_dj_provider USING dj_provider::user_dj_provider;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN dj_provider SET DEFAULT 'google';--> statement-breakpoint
ALTER TABLE dj_journal_events ALTER COLUMN scope SET DATA TYPE discovery_scope USING scope::discovery_scope;--> statement-breakpoint
ALTER TABLE dj_journal_events ALTER COLUMN origin SET DATA TYPE journal_origin USING origin::journal_origin;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN scope SET DATA TYPE discovery_scope USING scope::discovery_scope;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN requested_scope SET DATA TYPE discovery_scope USING requested_scope::discovery_scope;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN trigger SET DATA TYPE turn_trigger USING trigger::turn_trigger;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN status DROP DEFAULT;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN status SET DATA TYPE turn_status USING status::turn_status;--> statement-breakpoint
ALTER TABLE dj_turns ALTER COLUMN status SET DEFAULT 'running';
