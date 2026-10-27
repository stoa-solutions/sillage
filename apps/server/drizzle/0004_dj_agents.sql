-- DJ agents: profiles added to the DJ rules. Base agents (base_key, no owner) are written from
-- code at every start, so editing their text needs no migration; custom agents belong to an account.
CREATE TABLE "dj_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"base_key" text,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dj_agents_base_key_key" UNIQUE("base_key"),
	CONSTRAINT "dj_agents_owner_check" CHECK (("dj_agents"."user_id" IS NULL) <> ("dj_agents"."base_key" IS NULL)),
	CONSTRAINT "dj_agents_size_check" CHECK (char_length("dj_agents"."name") BETWEEN 1 AND 40 AND char_length("dj_agents"."instructions") <= 1500)
);
--> statement-breakpoint
ALTER TABLE "dj_agents" ADD CONSTRAINT "dj_agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dj_agents_user" ON "dj_agents" USING btree ("user_id","created_at");