CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgname='recall_simple' AND pg_ts_config_is_visible(oid)) THEN
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

CREATE TABLE IF NOT EXISTS dj_settings (
  token_id uuid PRIMARY KEY REFERENCES tokens(id) ON DELETE CASCADE,
  encrypted_key text NOT NULL, model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The public YouTube catalog is shared; ownership and credentials never are.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, google_sub text UNIQUE, email text, name text,
  created_at timestamptz NOT NULL DEFAULT now(), legacy_claimed_by uuid REFERENCES users(id)
);
INSERT INTO users(id,name) VALUES('00000000-0000-4000-8000-000000000001','Bibliothèque historique') ON CONFLICT DO NOTHING;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES users(id);
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
CREATE TABLE IF NOT EXISTS user_playlists (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id text NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,playlist_id)
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2) THEN
    INSERT INTO user_playlists(user_id,playlist_id) SELECT '00000000-0000-4000-8000-000000000001',id FROM playlists ON CONFLICT DO NOTHING;
    INSERT INTO schema_migrations(version) VALUES(2);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS account_dj_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key text NOT NULL, model text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_dj_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL,
  requests integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash text PRIMARY KEY, cookie_hash text NOT NULL, challenge text NOT NULL,
  app_state text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  code_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge text NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS channel_id text;
CREATE TABLE IF NOT EXISTS channels (id text PRIMARY KEY, avatar_url text, fetched_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS lyrics (
  video_id text PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE, status text NOT NULL,
  source_id bigint, lines jsonb NOT NULL DEFAULT '[]', plain_text text, duration_delta_ms integer,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lyrics_offsets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  offset_ms integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, video_id)
);

-- Additive catalog enrichment. Original YouTube fields remain unchanged.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS music_metadata jsonb;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS music_search_document tsvector GENERATED ALWAYS AS
  (to_tsvector('recall_simple',coalesce(music_metadata->>'searchText',''))) STORED;
CREATE INDEX IF NOT EXISTS videos_music_lexical ON videos USING gin(music_search_document);
CREATE TABLE IF NOT EXISTS musicbrainz_cache (url text PRIMARY KEY, response jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now());
-- Every writer shares the same index revision; YouTube refreshes retain current enrichment.
CREATE OR REPLACE FUNCTION recall_music_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.title,NEW.channel,NEW.duration_seconds) IS DISTINCT FROM (OLD.title,OLD.channel,OLD.duration_seconds) THEN
    NEW.music_metadata := NULL;
  END IF;
  NEW.content_hash := split_part(NEW.content_hash,':',1) || CASE WHEN NEW.music_metadata->>'status'='matched' THEN ':' || md5(NEW.music_metadata::text) ELSE '' END;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER videos_music_revision BEFORE INSERT OR UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION recall_music_revision();
