import { and, eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailInfraProvider } from "@/lib/email-infra";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Get the current status of an infra order. Refreshes from the live
 * InboxKit API (when configured) and updates the cached local row so
 * guardrails.ts's domain-health cache stays fresh even between webhook
 * deliveries.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await adminDb
    .select()
    .from(schema.infraOrders)
    .where(
      and(
        eq(schema.infraOrders.id, id),
        eq(schema.infraOrders.clerkUserId, userId),
      ),
    )
    .limit(1);

  if (!row) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const provider = getEmailInfraProvider();
  if (provider.enabled && row.providerOrderId) {
    try {
      const live = await provider.getOrder(row.providerOrderId);
      const [updated] = await adminDb
        .update(schema.infraOrders)
        .set({
          status: live.status,
          lastEvent: live as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(schema.infraOrders.id, id))
        .returning();
      return Response.json({ order: updated ?? row });
    } catch (err) {
      // Live refresh failed — return the last known cached state rather than
      // erroring the whole request.
      return Response.json({
        order: row,
        refreshError: err instanceof Error ? err.message : "refresh failed",
      });
    }
  }

  return Response.json({ order: row });
}
