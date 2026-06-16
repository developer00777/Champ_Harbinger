CREATE TABLE IF NOT EXISTS "enrichment_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_hash" text NOT NULL,
	"provider" text NOT NULL,
	"payload" jsonb NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttl_seconds" integer DEFAULT 604800 NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_cache_identity_provider_unique" UNIQUE("identity_hash","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"person_id" uuid,
	"organization_id" uuid,
	"external_ref" text,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"company" text,
	"domain" text,
	"email" text,
	"phone" text,
	"title" text,
	"seniority" text,
	"linkedin" text,
	"firmographics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness_score" numeric(4, 3) DEFAULT '0' NOT NULL,
	"confidence_score" numeric(4, 3) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"source" text NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"start_tier" text DEFAULT 'T0_master' NOT NULL,
	"resolved_tier" text,
	"required_fields" jsonb DEFAULT '["email","title","company"]'::jsonb NOT NULL,
	"confidence_threshold" numeric(4, 3),
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"contact_id" uuid,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"request_identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"fields_returned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"http_status" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text,
	"lakeb2b_id" text,
	"email" text,
	"linkedin_url" text,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"domain" text,
	"company_name" text,
	"phone" text,
	"title" text,
	"seniority" text,
	"firmographics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'harbinger_waterfall' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_verified" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'local_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text,
	"lakeb2b_id" text,
	"domain" text,
	"name" text,
	"industry" text,
	"employee_count" text,
	"revenue_band" text,
	"firmographics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'harbinger_waterfall' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"last_verified" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'local_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_writeback_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"master_record_id" text,
	"fields_written" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'written' NOT NULL,
	"rollback_token" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_contacts" ADD CONSTRAINT "enrichment_contacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_contacts" ADD CONSTRAINT "enrichment_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_field_provenance" ADD CONSTRAINT "enrichment_field_provenance_contact_id_enrichment_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."enrichment_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_contact_id_enrichment_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."enrichment_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_provider_calls" ADD CONSTRAINT "enrichment_provider_calls_job_id_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enrichment_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_provider_calls" ADD CONSTRAINT "enrichment_provider_calls_contact_id_enrichment_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."enrichment_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_writeback_log" ADD CONSTRAINT "master_writeback_log_contact_id_enrichment_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."enrichment_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_cache_lookup_idx" ON "enrichment_cache" USING btree ("identity_hash","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_cache_expires_idx" ON "enrichment_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_clerk_user_id_idx" ON "enrichment_contacts" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_clerk_org_id_idx" ON "enrichment_contacts" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_email_idx" ON "enrichment_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_domain_idx" ON "enrichment_contacts" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_external_ref_idx" ON "enrichment_contacts" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_status_idx" ON "enrichment_contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_contacts_person_idx" ON "enrichment_contacts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_field_provenance_contact_idx" ON "enrichment_field_provenance" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_field_provenance_field_idx" ON "enrichment_field_provenance" USING btree ("contact_id","field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_jobs_contact_idx" ON "enrichment_jobs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_jobs_status_idx" ON "enrichment_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_jobs_clerk_user_id_idx" ON "enrichment_jobs" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_provider_calls_job_idx" ON "enrichment_provider_calls" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_provider_calls_contact_idx" ON "enrichment_provider_calls" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_provider_calls_provider_idx" ON "enrichment_provider_calls" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrichment_provider_calls_created_idx" ON "enrichment_provider_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_email_idx" ON "master_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_linkedin_idx" ON "master_contacts" USING btree ("linkedin_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_domain_idx" ON "master_contacts" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_lakeb2b_idx" ON "master_contacts" USING btree ("lakeb2b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_name_domain_idx" ON "master_contacts" USING btree ("full_name","domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_contacts_sync_status_idx" ON "master_contacts" USING btree ("sync_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_organizations_domain_idx" ON "master_organizations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_organizations_name_idx" ON "master_organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_organizations_lakeb2b_idx" ON "master_organizations" USING btree ("lakeb2b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_organizations_sync_status_idx" ON "master_organizations" USING btree ("sync_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_writeback_log_contact_idx" ON "master_writeback_log" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_writeback_log_rollback_idx" ON "master_writeback_log" USING btree ("rollback_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_writeback_log_master_idx" ON "master_writeback_log" USING btree ("master_record_id");