ALTER TABLE "sent_emails" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD COLUMN "replied_at" timestamp with time zone;