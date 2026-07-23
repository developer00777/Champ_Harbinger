ALTER TABLE "email_drafts" ADD COLUMN "review_feedback" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "rejection_reason" text;