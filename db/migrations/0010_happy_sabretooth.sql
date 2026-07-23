CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "infra_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'inboxkit' NOT NULL,
	"provider_order_id" text,
	"clerk_user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"request" jsonb NOT NULL,
	"last_event" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"fact_text" text NOT NULL,
	"confidence" numeric(4, 3),
	"source" text,
	"episode_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"invalid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"clerk_user_id" text,
	"ref_table" text,
	"ref_id" uuid,
	"content" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kg_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"ref_table" text,
	"ref_id" uuid,
	"summary" text,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "per_user_daily_limit_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "daily_limit_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "per_user_default_daily_limit_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "warm_intro_email" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "warm_intro_name" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "aisdr_mode" text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "preferred_model" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_source_id_kg_nodes_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kg_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_target_id_kg_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."kg_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_episode_id_kg_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."kg_episodes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "infra_orders_user_idx" ON "infra_orders" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "infra_orders_provider_order_idx" ON "infra_orders" USING btree ("provider_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_edges_source_idx" ON "kg_edges" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_edges_target_idx" ON "kg_edges" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_edges_relation_idx" ON "kg_edges" USING btree ("relation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_episodes_kind_idx" ON "kg_episodes" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_episodes_unprocessed_idx" ON "kg_episodes" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_nodes_kind_name_idx" ON "kg_nodes" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_nodes_ref_idx" ON "kg_nodes" USING btree ("ref_table","ref_id");