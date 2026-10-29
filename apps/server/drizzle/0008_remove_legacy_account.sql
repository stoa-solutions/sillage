-- The historical account (from before Google sign-in) goes away. Its library was claimed by a
-- Google account; refuse to run on a database where it still owns playlists or history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
    WHERE id = '00000000-0000-4000-8000-000000000001' AND legacy_claimed_by IS NULL
      AND (EXISTS (SELECT 1 FROM user_playlists WHERE user_id = users.id)
        OR EXISTS (SELECT 1 FROM listening_history WHERE user_id = users.id))
  ) THEN
    RAISE EXCEPTION 'The historical library was never claimed: claim it before removing the legacy account.';
  END IF;
END $$;--> statement-breakpoint
-- Its remaining tokens are revoked by deletion; everything else it owned cascades.
DELETE FROM tokens WHERE user_id = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
DELETE FROM users WHERE id = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE users SET dj_provider = 'google' WHERE dj_provider = 'legacy';--> statement-breakpoint
-- Types live in the current schema (public in production, a suite's own schema in tests).
-- Pre-account DJ keys and the environment key's budget: read by no code since accounts.
DROP TABLE "dj_settings" CASCADE;--> statement-breakpoint
DROP TABLE "dj_usage" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_legacy_claimed_by_fkey";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "dj_provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "dj_provider" SET DEFAULT 'google'::text;--> statement-breakpoint
DROP TYPE "user_dj_provider";--> statement-breakpoint
CREATE TYPE "user_dj_provider" AS ENUM('google', 'anthropic');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "dj_provider" SET DEFAULT 'google'::"user_dj_provider";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "dj_provider" SET DATA TYPE "user_dj_provider" USING "dj_provider"::"user_dj_provider";--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "legacy_claimed_by";