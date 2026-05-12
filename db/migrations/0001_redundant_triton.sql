CREATE TABLE IF NOT EXISTS "user_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"key_name" text NOT NULL,
	"key_value_encrypted" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_suffix" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_keys_user_key_unique" UNIQUE("clerk_user_id","key_name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_api_keys_clerk_user_id_idx" ON "user_api_keys" USING btree ("clerk_user_id");