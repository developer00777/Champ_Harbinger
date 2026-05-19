CREATE TABLE IF NOT EXISTS "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"title" text,
	"link" text,
	"published_at" timestamp with time zone,
	"summary" text,
	"content" text,
	"processed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_items_feed_guid_uniq" UNIQUE("feed_id","guid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monitored_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"organization_id" uuid,
	"feed_url" text NOT NULL,
	"feed_type" text DEFAULT 'rss' NOT NULL,
	"title" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"error_count" integer DEFAULT 0,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitored_feeds_user_url_uniq" UNIQUE("clerk_user_id","feed_url")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_feed_id_monitored_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."monitored_feeds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_items_feed_idx" ON "feed_items" USING btree ("feed_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_feeds_user_idx" ON "monitored_feeds" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_feeds_org_idx" ON "monitored_feeds" USING btree ("organization_id");