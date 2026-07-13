import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { planMasterSync } from "@/lib/enrichment/sync-queue";

const BodySchema = z.object({
  ids: z.array(z.string()).max(1000).nullable().optional(),
});

/**
 * POST /api/sync/master
 *
 * The one-click master-DB sync writer (spec §8 / screen 5). Marks staged
 * (local_only) master contacts as synced — flipping syncStatus -> in_sync and
 * stamping lastSyncedAt — so the biweekly/monthly push loop is a functional
 * button, not a spreadsheet. The actual outbound push to the external LakeB2B
 * master is the deferred human/DSN loop (LAKEB2B_MASTER_DSN); this closes the
 * owned side. Only rows that are actually staged in the caller's scope are
 * touched; a requested id that is not staged is reported skipped.
 */
export async function POST(request: Request) {
  let orgId: string | null;
  try {
    ({ orgId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid body";
    return Response.json({ error: `Invalid body: ${msg}` }, { status: 400 });
  }

  const mc = schema.masterContacts;
  const orgCond: SQL = orgId ? eq(mc.clerkOrgId, orgId) : isNull(mc.clerkOrgId);

  const staged = await adminDb
    .select({ id: mc.id })
    .from(mc)
    .where(and(eq(mc.syncStatus, "local_only"), orgCond));
  const stagedIds = staged.map((r) => r.id);

  const requested = body.ids ?? null;
  const { toSync, skipped } = planMasterSync(stagedIds, requested);

  if (toSync.length > 0) {
    await adminDb
      .update(mc)
      .set({ syncStatus: "in_sync", lastSyncedAt: new Date() })
      .where(
        and(eq(mc.syncStatus, "local_only"), orgCond, inArray(mc.id, toSync)),
      );
  }

  return Response.json({
    synced: toSync.length,
    skipped,
    remainingStaged: stagedIds.length - toSync.length,
    note: "Marked as synced to the owned master. Outbound push to the external LakeB2B master runs on the team cadence (LAKEB2B_MASTER_DSN).",
  });
}
