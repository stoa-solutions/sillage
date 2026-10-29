-- account_dj_settings held one Google key per account before keys existed per provider.
-- Copy any key that never reached account_ai_credentials, then drop the mirror.
INSERT INTO account_ai_credentials(user_id,provider,encrypted_key,model,updated_at)
  SELECT user_id,'google',encrypted_key,model,updated_at FROM account_dj_settings
  ON CONFLICT (user_id,provider) DO NOTHING;--> statement-breakpoint
DROP TABLE "account_dj_settings" CASCADE;