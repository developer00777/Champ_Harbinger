CREATE TABLE IF NOT EXISTS "champiq_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"company_name" text NOT NULL,
	"company_domain" text NOT NULL,
	"company_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_id" uuid,
	"signal_name" text,
	"signal_reasoning" text,
	"signal_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" real,
	"talking_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pushed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "champiq_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "champiq_handoff_mode" text DEFAULT 'review';--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "champiq_signal_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "champiq_queue_clerk_user_id_idx" ON "champiq_queue" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "champiq_queue_status_idx" ON "champiq_queue" USING btree ("status");