import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { LEGACY_USER_ID, timestamptz } from "./columns.ts";

/** A Google account, or the historical library (LEGACY_USER_ID). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    googleSub: text("google_sub").unique("users_google_sub_key"),
    email: text("email"),
    name: text("name"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** On the historical user only: the Google account that took its library over. */
    legacyClaimedBy: uuid("legacy_claimed_by"),
    /** "google", "anthropic", or "legacy" for the untouched historical account. */
    djProvider: text("dj_provider").notNull().default("google"),
  },
  (t) => [
    foreignKey({
      name: "users_legacy_claimed_by_fkey",
      columns: [t.legacyClaimedBy],
      foreignColumns: [t.id],
    }),
  ],
);

/** One signed-in installation. Only the SHA-256 of its bearer token is stored. */
export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    hash: text("hash").notNull().unique("tokens_hash_key"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    userId: uuid("user_id")
      .notNull()
      .default(sql`'${sql.raw(LEGACY_USER_ID)}'::uuid`),
    /** Null for personal tokens made by the CLI: they never expire, they are revoked. */
    expiresAt: timestamptz("expires_at"),
  },
  (t) => [
    foreignKey({
      name: "tokens_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    index("tokens_user").on(t.userId),
  ],
);

/** A Google sign-in in progress (10 minutes), bound to the browser by a cookie. */
export const oauthFlows = pgTable("oauth_flows", {
  stateHash: text("state_hash").primaryKey(),
  cookieHash: text("cookie_hash").notNull(),
  /** PKCE S256 challenge of the native app. */
  challenge: text("challenge").notNull(),
  appState: text("app_state").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
});

/** The one-time code handed back to the app (90 seconds), traded with the PKCE verifier. */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: uuid("user_id").notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "oauth_grants_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

/** A personal AI key per provider, AES-256-GCM encrypted with the user id as AAD. */
export const accountAiCredentials = pgTable(
  "account_ai_credentials",
  {
    userId: uuid("user_id").notNull(),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "account_ai_credentials_pkey",
      columns: [t.userId, t.provider],
    }),
    foreignKey({
      name: "account_ai_credentials_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    check(
      "account_ai_credentials_provider_check",
      sql`${t.provider} = ANY (ARRAY['google'::text, 'anthropic'::text])`,
    ),
  ],
);

/** Google mirror of accountAiCredentials, kept so an older server can still run. */
export const accountDjSettings = pgTable(
  "account_dj_settings",
  {
    userId: uuid("user_id").primaryKey(),
    encryptedKey: text("encrypted_key").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "account_dj_settings_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const accountDjUsage = pgTable(
  "account_dj_usage",
  {
    userId: uuid("user_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "account_dj_usage_pkey", columns: [t.userId, t.day] }),
    foreignKey({
      name: "account_dj_usage_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

/** Pre-account DJ key, attached to a personal token. */
export const djSettings = pgTable(
  "dj_settings",
  {
    tokenId: uuid("token_id").primaryKey(),
    encryptedKey: text("encrypted_key").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "dj_settings_token_id_fkey",
      columns: [t.tokenId],
      foreignColumns: [tokens.id],
    }).onDelete("cascade"),
  ],
);

/** Server-wide daily DJ budget of the environment key. */
export const djUsage = pgTable("dj_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  requests: integer("requests").notNull().default(0),
});
