import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/queue
 *
 * The "ready to sync" queue (spec §8): verified, high-confidence contacts in the
 * owned master that have not yet been pushed to the LakeB2B master
 * (syncStatus = 'local_only'). Scoped to the caller's org grain (the master is
 * the shared owned asset). Writeback already stages only verified + above-floor
 * fields, so everything here is push-ready.
 */
export async function GET() {
  let orgId: string | null;
  try {
    ({ orgId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mc = schema.masterContacts;
  const orgCond: SQL = orgId ? eq(mc.clerkOrgId, orgId) : isNull(mc.clerkOrgId);

  const queue = await adminDb
    .select({
      id: mc.id,
      fullName: mc.fullName,
      email: mc.email,
      companyName: mc.companyName,
      title: mc.title,
      seniority: mc.seniority,
      confidence: mc.confidence,
      verified: mc.verified,
      source: mc.source,
      lastVerified: mc.lastVerified,
    })
    .from(mc)
    .where(and(eq(mc.syncStatus, "local_only"), orgCond))
    .orderBy(desc(mc.lastVerified))
    .limit(500);

  return Response.json({ queue });
}
