CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgname='recall_simple') THEN
    CREATE TEXT SEARCH CONFIGURATION recall_simple (COPY = pg_catalog.simple);
    ALTER TEXT SEARCH CONFIGURATION recall_simple ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tokens (id uuid PRIMARY KEY, name text NOT NULL, hash text UNIQUE NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS playlists (
  id text PRIMARY KEY, title text NOT NULL, source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_sync_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(), sync_enabled boolean NOT NULL DEFAULT true,
  generation bigint NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending', error text
);
CREATE TABLE IF NOT EXISTS videos (
  id text PRIMARY KEY, title text, channel text, duration_seconds double precision,
  description text NOT NULL DEFAULT '', tags jsonb NOT NULL DEFAULT '[]', published_at text,
  thumbnail_url text NOT NULL, content_hash text NOT NULL, index_hash text,
  enriched_at timestamptz, available boolean NOT NULL DEFAULT true,
  image_hash text, image_checked_at timestamptz, image_error text,
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('recall_simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('recall_simple', coalesce(channel,'')), 'A') ||
    setweight(to_tsvector('recall_simple', tags::text), 'B') ||
    setweight(to_tsvector('recall_simple', description), 'C')
  ) STORED
);
CREATE INDEX IF NOT EXISTS videos_lexical ON videos USING gin(search_document);
CREATE TABLE IF NOT EXISTS memberships (
  key text PRIMARY KEY, playlist_id text NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id text NOT NULL REFERENCES videos(id), position integer NOT NULL,
  added_at timestamptz, seen_generation bigint NOT NULL, missing_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS memberships_playlist ON memberships(playlist_id,active,position);
CREATE INDEX IF NOT EXISTS memberships_video ON memberships(video_id,active);
CREATE TABLE IF NOT EXISTS passages (
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE, ordinal integer NOT NULL,
  text text NOT NULL, source_hash text NOT NULL, model_key text NOT NULL, embedding vector(384) NOT NULL,
  PRIMARY KEY(video_id,ordinal)
);
CREATE TABLE IF NOT EXISTS images (
  video_id text PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  source_hash text NOT NULL, source_url text NOT NULL, model_key text NOT NULL, embedding vector(768) NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, kind text NOT NULL, dedupe_key text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
  lease_id uuid, error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_key ON jobs(dedupe_key) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,available_at);
CREATE TABLE IF NOT EXISTS quota_usage (day date PRIMARY KEY, units integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY, playlist_id text NOT NULL REFERENCES playlists(id),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL DEFAULT 'running', entries integer, error text
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS dj_usage (day date PRIMARY KEY, requests integer NOT NULL DEFAULT 0);
