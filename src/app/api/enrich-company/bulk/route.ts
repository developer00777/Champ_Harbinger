import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";
import { assertWithinBudget } from "@/lib/budget/guard";
import { budgetErrorResponse } from "@/lib/budget/respond";

/**
 * Bulk-enrich every company in a campaign asynchronously via the pg-boss queue
 * (the worker processes them ~5 at a time). Returns immediately with how many
 * were queued. Poll GET for progress.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaignId?: string; includeEnriched?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { campaignId, includeEnriched = false } = body;
  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }

  const [campaign] = await adminDb
    .select({ clerkUserId: schema.campaigns.clerkUserId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.clerkUserId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await adminDb
    .select({
      id: schema.organizations.id,
      status: schema.organizations.enrichmentStatus,
    })
    .from(schema.campaignOrganizations)
    .innerJoin(
      schema.organizations,
      eq(schema.campaignOrganizations.organizationId, schema.organizations.id),
    )
    .where(eq(schema.campaignOrganizations.campaignId, campaignId));

  const targets = rows.filter(
    (r) => includeEnriched || r.status !== "enriched",
  );

  // Don't queue a big bulk run if the user/team is already over its weekly cap.
  try {
    await assertWithinBudget({ userId });
  } catch (err) {
    const blocked = budgetErrorResponse(err, {
      queued: 0,
      blocked: targets.length,
    });
    if (blocked) return blocked;
    throw err;
  }

  for (const t of targets) {
    await enqueueEnrichCompany({ companyId: t.id, campaignId, userId });
  }

  return Response.json({ queued: targets.length, total: rows.length });
}

/** Progress for the "Enrich all" UI: total vs enriched company counts. */
export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const campaignId = new URL(request.url).searchParams.get("campaignId");
  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }

  const [campaign] = await adminDb
    .select({ clerkUserId: schema.campaigns.clerkUserId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign || campaign.clerkUserId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await adminDb
    .select({ status: schema.organizations.enrichmentStatus })
    .from(schema.campaignOrganizations)
    .innerJoin(
      schema.organizations,
      eq(schema.campaignOrganizations.organizationId, schema.organizations.id),
    )
    .where(eq(schema.campaignOrganizations.campaignId, campaignId));

  const total = rows.length;
  const enriched = rows.filter((r) => r.status === "enriched").length;
  return Response.json({ total, enriched, pending: total - enriched });
}
