import { desc, eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailInfraProvider } from "@/lib/email-infra";

export const runtime = "nodejs";
export const maxDuration = 30;

/** List this user's infra orders (local record, updated by the InboxKit webhook). */
export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await adminDb
    .select()
    .from(schema.infraOrders)
    .where(eq(schema.infraOrders.clerkUserId, userId))
    .orderBy(desc(schema.infraOrders.createdAt));

  return Response.json({ orders: rows });
}

/**
 * Place a domain + mailbox order with InboxKit. Creates the order via the
 * provider, then records it locally in infra_orders — the webhook
 * (/api/webhooks/inboxkit) keeps `status`/`lastEvent` current as InboxKit
 * provisions the domain and mailboxes.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = getEmailInfraProvider();
  if (!provider.enabled) {
    return Response.json(
      {
        error:
          "Email infrastructure is not configured (INBOXKIT_API_KEY missing).",
      },
      { status: 501 },
    );
  }

  let body: {
    domain?: string;
    mailboxCount?: number;
    mailboxUsernames?: string[];
    displayName?: string;
    forwardingUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim();
  const mailboxCount = Number(body.mailboxCount ?? 0);
  if (!domain || !mailboxCount || mailboxCount < 1) {
    return Response.json(
      { error: "domain and a positive mailboxCount are required" },
      { status: 400 },
    );
  }

  const request_ = {
    domain,
    mailboxCount,
    mailboxUsernames: body.mailboxUsernames,
    displayName: body.displayName,
    forwardingUrl: body.forwardingUrl,
  };

  let order;
  try {
    order = await provider.createOrder(request_);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to place order" },
      { status: 502 },
    );
  }

  const [row] = await adminDb
    .insert(schema.infraOrders)
    .values({
      provider: "inboxkit",
      providerOrderId: order.providerOrderId,
      clerkUserId: userId,
      status: order.status || "queued",
      request: request_,
      lastEvent: order as unknown as Record<string, unknown>,
    })
    .returning();

  return Response.json({ order: row });
}
