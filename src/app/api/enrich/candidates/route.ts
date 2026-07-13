import { eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { canonicalRequiredFields } from "@/lib/enrichment/required-fields";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrich/candidates?campaignId=...
 *
 * The people staged on a campaign (from Discover / upload), shaped as waterfall
 * seeds for the live Enrich screen, plus the campaign's required-field set and
 * per-job budget cap (spec §3) so the run inherits the rep's ingest settings.
 */
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
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      icp: schema.campaigns.icp,
      clerkUserId: schema.campaigns.clerkUserId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.clerkUserId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const icp = (campaign.icp as Record<string, unknown> | null) ?? {};
  const requiredFields = canonicalRequiredFields(
    Array.isArray(icp.requiredFields) ? (icp.requiredFields as string[]) : [],
  );
  const budgetCapUsd =
    typeof icp.budgetCapUsd === "number" ? icp.budgetCapUsd : null;

  const rows = await adminDb
    .select({
      personId: schema.people.id,
      name: schema.people.name,
      title: schema.people.title,
      email: schema.people.workEmail,
      linkedin: schema.people.linkedinUrl,
      company: schema.organizations.name,
      domain: schema.organizations.domain,
    })
    .from(schema.campaignPeople)
    .innerJoin(
      schema.people,
      eq(schema.campaignPeople.personId, schema.people.id),
    )
    .leftJoin(
      schema.organizations,
      eq(schema.people.organizationId, schema.organizations.id),
    )
    .where(eq(schema.campaignPeople.campaignId, campaignId));

  const candidates = rows.map((r) => ({
    personId: r.personId,
    name: r.name,
    title: r.title,
    company: r.company,
    domain: r.domain,
    email: r.email,
    linkedin: r.linkedin,
  }));

  return Response.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      requiredFields,
      budgetCapUsd,
    },
    candidates,
  });
}
