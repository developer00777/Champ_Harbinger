import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailInfraProvider } from "@/lib/email-infra";
import { importMailboxFromInboxKit } from "@/lib/email-infra/import-mailboxes";

export const runtime = "nodejs";
export const maxDuration = 10; // InboxKit requires a 2xx within 10s

/**
 * Inbound InboxKit status_change webhook. Body:
 *   { event: "status_change", data: { domain, status, mailboxes: [{email, status}] } }
 *
 * On receipt:
 *   1. Verify the shared secret (X-Webhook-Secret), same pattern as the
 *      ChampMail delivery webhook (/api/email/track).
 *   2. Find the matching infra_orders row (by domain) and stamp its
 *      status/last_event so guardrails.ts's cached domain-health check
 *      stays current without a live API round-trip.
 *   3. For any mailbox that just turned ready/active, fetch full SMTP+IMAP
 *      credentials from InboxKit and import it into mailbox_connections
 *      (src/lib/email-infra/import-mailboxes.ts) so it's immediately usable
 *      by send_message.
 *
 * Must ack within 10s — mailbox credential imports run best-effort and
 * never block the 2xx response beyond that budget.
 */

const READY_STATUSES = new Set(["active", "ready", "verified"]);

function verifySecret(request: Request): boolean {
  const expected = process.env.INBOXKIT_WEBHOOK_SECRET;
  if (!expected) return true; // unset -> allow (dev)
  const got = request.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface InboxKitWebhookPayload {
  event?: string;
  data?: {
    domain?: string;
    status?: string;
    mailboxes?: Array<{ email: string; status: string }>;
    spf_verified?: boolean;
    dkim_verified?: boolean;
    dmarc_verified?: boolean;
  };
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: InboxKitWebhookPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.data?.domain;
  if (!body.event || !domain) {
    return NextResponse.json(
      { error: "event and data.domain are required" },
      { status: 400 },
    );
  }

  // Find the local order row for this domain (request.domain set at creation time).
  const orders = await adminDb
    .select()
    .from(schema.infraOrders)
    .where(eq(schema.infraOrders.provider, "inboxkit"));

  const order = orders.find((o) => {
    const req = o.request as Record<string, unknown> | null;
    const evt = o.lastEvent as Record<string, unknown> | null;
    return req?.domain === domain || evt?.domain === domain;
  });

  const lastEvent = {
    domain,
    status: body.data?.status,
    spfVerified: body.data?.spf_verified,
    dkimVerified: body.data?.dkim_verified,
    dmarcVerified: body.data?.dmarc_verified,
    mailboxes: body.data?.mailboxes ?? [],
    receivedAt: new Date().toISOString(),
  };

  if (order) {
    await adminDb
      .update(schema.infraOrders)
      .set({
        status: body.data?.status ?? order.status,
        lastEvent,
        updatedAt: new Date(),
      })
      .where(eq(schema.infraOrders.id, order.id));
  }

  // Best-effort mailbox credential import for newly-ready mailboxes. Never
  // let a slow/failed credential fetch block the webhook ack.
  const readyMailboxes = (body.data?.mailboxes ?? []).filter((m) =>
    READY_STATUSES.has(m.status),
  );
  if (order && readyMailboxes.length > 0) {
    const provider = getEmailInfraProvider();
    if (provider.enabled) {
      await Promise.allSettled(
        readyMailboxes.map(async (m) => {
          const credentials = await provider.getMailboxCredentials(m.email);
          await importMailboxFromInboxKit({
            clerkUserId: order.clerkUserId,
            domain,
            credentials,
          });
        }),
      );
    }
  }

  return NextResponse.json({ ok: true, matchedOrder: order?.id ?? null });
}
