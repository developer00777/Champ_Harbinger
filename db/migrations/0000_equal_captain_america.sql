CREATE TABLE IF NOT EXISTS "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"service" text NOT NULL,
	"operation" text NOT NULL,
	"tokens_input" integer,
	"tokens_output" integer,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campaign_id" uuid,
	"action_id" uuid,
	"action_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"relevance_score" numeric(3, 1) DEFAULT '0',
	"score_reason" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"readiness_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_organizations_unique" UNIQUE("campaign_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"outreach_status" text DEFAULT 'not_contacted' NOT NULL,
	"priority_score" numeric(3, 1) DEFAULT '0',
	"score_reason" text,
	"readiness_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_people_unique" UNIQUE("campaign_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_signals_unique" UNIQUE("campaign_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'discovery' NOT NULL,
	"icp" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"offering" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"positioning" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"title" text DEFAULT 'New chat' NOT NULL,
	"campaign_id" uuid,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"campaign_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"campaign_people_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text,
	"reply_to" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"sequence_id" uuid,
	"sequence_step_id" uuid,
	"enrollment_id" uuid,
	"ai_reasoning" text,
	"review_status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_skill_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_skill_attachments_unique" UNIQUE("skill_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"instructions" text NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"url" text,
	"industry" text,
	"location" text,
	"description" text,
	"enrichment_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enrichment_status" text DEFAULT 'pending' NOT NULL,
	"last_enriched_at" timestamp with time zone,
	"source" text,
	"email_pattern" text,
	"email_pattern_confidence" real,
	"email_pattern_evidence_count" integer DEFAULT 0 NOT NULL,
	"email_pattern_bounce_count" integer DEFAULT 0 NOT NULL,
	"email_pattern_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"linkedin_url" text,
	"work_email" text,
	"personal_email" text,
	"twitter_url" text,
	"github_url" text,
	"title" text,
	"organization_id" uuid,
	"enrichment_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enrichment_status" text DEFAULT 'pending' NOT NULL,
	"last_enriched_at" timestamp with time zone,
	"source" text,
	"work_email_verified_at" timestamp with time zone,
	"personal_email_verified_at" timestamp with time zone,
	"work_email_source" text,
	"work_email_confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sent_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"agentmail_message_id" text NOT NULL,
	"agentmail_thread_id" text,
	"draft_id" uuid,
	"campaign_people_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"from_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sent_emails_agentmail_message_id_unique" UNIQUE("agentmail_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"campaign_people_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"waiting_since" timestamp with time zone DEFAULT now(),
	"next_send_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_enrollments_unique" UNIQUE("sequence_id","campaign_people_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"step_type" text DEFAULT 'email' NOT NULL,
	"delay_days" integer,
	"delay_hours" integer,
	"condition" text DEFAULT 'no_reply',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_steps_unique" UNIQUE("sequence_id","step_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"name" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"trigger_signal_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"organization_id" uuid,
	"person_id" uuid,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"tracking_config_id" uuid,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"category" text DEFAULT 'custom' NOT NULL,
	"icon" text,
	"execution_type" text DEFAULT 'agent_instructions' NOT NULL,
	"tool_key" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_config_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"field_path" text,
	"previous_value" jsonb,
	"current_value" jsonb,
	"description" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"organization_id" uuid,
	"person_id" uuid,
	"signal_id" uuid NOT NULL,
	"schedule" text DEFAULT 'weekly' NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_config_id" uuid NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"label" text,
	"name" text,
	"email" text,
	"company_name" text,
	"company_url" text,
	"personal_url" text,
	"linkedin_url" text,
	"twitter_url" text,
	"role_title" text,
	"offering_summary" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"clerk_org_id" text,
	"agentmail_inbox_id" text,
	"from_name" text,
	"reply_to_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_organizations" ADD CONSTRAINT "campaign_organizations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_organizations" ADD CONSTRAINT "campaign_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_people" ADD CONSTRAINT "campaign_people_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_people" ADD CONSTRAINT "campaign_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_signals" ADD CONSTRAINT "campaign_signals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_signals" ADD CONSTRAINT "campaign_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_campaign_people_id_campaign_people_id_fk" FOREIGN KEY ("campaign_people_id") REFERENCES "public"."campaign_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_sequence_step_id_sequence_steps_id_fk" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_enrollment_id_sequence_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."sequence_enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_skill_attachments" ADD CONSTRAINT "email_skill_attachments_skill_id_email_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."email_skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people" ADD CONSTRAINT "people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_draft_id_email_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_campaign_people_id_campaign_people_id_fk" FOREIGN KEY ("campaign_people_id") REFERENCES "public"."campaign_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_campaign_people_id_campaign_people_id_fk" FOREIGN KEY ("campaign_people_id") REFERENCES "public"."campaign_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_trigger_signal_id_signals_id_fk" FOREIGN KEY ("trigger_signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_results" ADD CONSTRAINT "signal_results_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_results" ADD CONSTRAINT "signal_results_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_results" ADD CONSTRAINT "signal_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_results" ADD CONSTRAINT "signal_results_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_changes" ADD CONSTRAINT "tracking_changes_tracking_config_id_tracking_configs_id_fk" FOREIGN KEY ("tracking_config_id") REFERENCES "public"."tracking_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_configs" ADD CONSTRAINT "tracking_configs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_configs" ADD CONSTRAINT "tracking_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_configs" ADD CONSTRAINT "tracking_configs_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_configs" ADD CONSTRAINT "tracking_configs_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_snapshots" ADD CONSTRAINT "tracking_snapshots_tracking_config_id_tracking_configs_id_fk" FOREIGN KEY ("tracking_config_id") REFERENCES "public"."tracking_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_created_at_idx" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_service_idx" ON "api_usage" USING btree ("service","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_campaign_idx" ON "api_usage" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_action_idx" ON "api_usage" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_clerk_user_id_idx" ON "api_usage" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_orgs_campaign_idx" ON "campaign_organizations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_orgs_org_idx" ON "campaign_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_orgs_status_idx" ON "campaign_organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_orgs_readiness_idx" ON "campaign_organizations" USING btree ("readiness_tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_people_campaign_idx" ON "campaign_people" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_people_person_idx" ON "campaign_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_people_outreach_idx" ON "campaign_people" USING btree ("outreach_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_people_priority_idx" ON "campaign_people" USING btree ("priority_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_people_readiness_idx" ON "campaign_people" USING btree ("readiness_tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_signals_campaign_idx" ON "campaign_signals" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_signals_signal_idx" ON "campaign_signals" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_clerk_user_id_idx" ON "campaigns" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_clerk_org_id_idx" ON "campaigns" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_updated_at_idx" ON "chats" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_campaign_id_idx" ON "chats" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_clerk_user_id_idx" ON "chats" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_campaign_status_idx" ON "email_drafts" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_cleanup_idx" ON "email_drafts" USING btree ("created_at","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_sequence_idx" ON "email_drafts" USING btree ("sequence_id","review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_clerk_user_id_idx" ON "email_drafts" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_skill_attachments_scope_idx" ON "email_skill_attachments" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_skill_attachments_skill_idx" ON "email_skill_attachments" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_skills_user_idx" ON "email_skills" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_skills_builtin_idx" ON "email_skills" USING btree ("is_builtin");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_domain_unique_idx" ON "organizations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_last_enriched_idx" ON "organizations" USING btree ("last_enriched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_events_campaign_date_idx" ON "outreach_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_events_date_status_idx" ON "outreach_events" USING btree ("created_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_linkedin_unique_idx" ON "people" USING btree ("linkedin_url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_github_url_unique_idx" ON "people" USING btree ("github_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_organization_id_idx" ON "people" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_last_enriched_idx" ON "people" USING btree ("last_enriched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_work_email_idx" ON "people" USING btree ("work_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_personal_email_idx" ON "people" USING btree ("personal_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_name_org_idx" ON "people" USING btree ("name","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sent_emails_campaign_idx" ON "sent_emails" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sent_emails_campaign_people_idx" ON "sent_emails" USING btree ("campaign_people_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sent_emails_thread_idx" ON "sent_emails" USING btree ("agentmail_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sent_emails_clerk_user_id_idx" ON "sent_emails" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_status_idx" ON "sequence_enrollments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_next_send_idx" ON "sequence_enrollments" USING btree ("next_send_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequences_campaign_idx" ON "sequences" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequences_status_idx" ON "sequences" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequences_clerk_user_id_idx" ON "sequences" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_signal_idx" ON "signal_results" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_campaign_idx" ON "signal_results" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_organization_idx" ON "signal_results" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_person_idx" ON "signal_results" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_ran_at_idx" ON "signal_results" USING btree ("ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_results_tracking_idx" ON "signal_results" USING btree ("tracking_config_id","ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_slug_idx" ON "signals" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_category_idx" ON "signals" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_builtin_idx" ON "signals" USING btree ("is_builtin");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_clerk_user_id_idx" ON "signals" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_changes_config_idx" ON "tracking_changes" USING btree ("tracking_config_id","detected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_configs_campaign_idx" ON "tracking_configs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_configs_status_idx" ON "tracking_configs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_configs_next_run_idx" ON "tracking_configs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_snapshots_config_idx" ON "tracking_snapshots" USING btree ("tracking_config_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profile_clerk_user_id_idx" ON "user_profile" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profile_clerk_org_id_idx" ON "user_profile" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_settings_clerk_user_id_idx" ON "user_settings" USING btree ("clerk_user_id");