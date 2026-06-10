import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Inbound delivery-tracking webhook. The email provider (ChampMail, or an n8n
 * flow bridging it) POSTs delivery events here; we stamp the matching
 * sent_emails row. Public route (see proxy.ts) guarded by a shared secret.
 *
 * Body: { event_type, message_id, timestamp? }
 *   event_type ∈ delivered | opened | clicked | bounced | replied
 */

const EVENT_COLUMN = {
  delivered: "deliveredAt",
  opened: "openedAt",
  clicked: "clickedAt",
  bounced: "bouncedAt",
  replied: "repliedAt",
} as const;

type EventType = keyof typeof EVENT_COLUMN;

function verifySecret(request: Request): boolean {
  const expected = process.env.CHAMPMAIL_WEBHOOK_SECRET;
  if (!expected) return true; // unset → allow (dev)
  const got = request.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { event_type?: string; message_id?: string; timestamp?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = body.event_type as EventType | undefined;
  if (!eventType || !(eventType in EVENT_COLUMN) || !body.message_id) {
    return NextResponse.json(
      {
        error:
          "event_type (delivered|opened|clicked|bounced|replied) and message_id are required",
      },
      { status: 400 },
    );
  }

  const at = body.timestamp ? new Date(body.timestamp) : new Date();
  const updated = await adminDb
    .update(schema.sentEmails)
    .set({ [EVENT_COLUMN[eventType]]: at, status: eventType })
    .where(eq(schema.sentEmails.agentmailMessageId, body.message_id))
    .returning({ id: schema.sentEmails.id });

  return NextResponse.json({ updated: updated.length });
}
