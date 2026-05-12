import { NextResponse } from "next/server";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, lt, and } from "drizzle-orm";

/**
 * Draft cleanup endpoint. Call via cron or QStash schedule.
 * - Deletes discarded drafts older than 7 days
 * - Deletes stale drafts (never sent) older than 30 days
 */
export async function POST() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Delete old discarded drafts
  const discardedRows = await adminDb
    .delete(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.status, "discarded"),
        lt(schema.emailDrafts.createdAt, sevenDaysAgo),
      ),
    )
    .returning({ id: schema.emailDrafts.id });

  // Delete stale unsent drafts
  const staleRows = await adminDb
    .delete(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.status, "draft"),
        lt(schema.emailDrafts.createdAt, thirtyDaysAgo),
      ),
    )
    .returning({ id: schema.emailDrafts.id });

  return NextResponse.json({
    cleaned: {
      discarded: discardedRows.length,
      stale: staleRows.length,
    },
  });
}
