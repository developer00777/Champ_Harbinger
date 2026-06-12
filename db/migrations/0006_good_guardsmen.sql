CREATE TABLE IF NOT EXISTS "mailbox_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_encrypted" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mailbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"from_address" text,
	"to_address" text,
	"subject" text,
	"snippet" text,
	"body" text,
	"sent_email_id" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_sent_email_id_sent_emails_id_fk" FOREIGN KEY ("sent_email_id") REFERENCES "public"."sent_emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_connections_user_idx" ON "mailbox_connections" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_messages_user_idx" ON "mailbox_messages" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_messages_connection_idx" ON "mailbox_messages" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_messages_message_id_idx" ON "mailbox_messages" USING btree ("message_id");