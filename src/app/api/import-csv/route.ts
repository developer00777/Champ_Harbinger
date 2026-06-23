import { getPostHogClient } from "@/lib/posthog-server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
  normalizeDomain,
} from "@/lib/services/knowledge-base";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { campaignId, companies } = body as {
    campaignId: string;
    companies: Array<{
      name: string;
      domain?: string | null;
      url?: string | null;
      industry?: string | null;
      location?: string | null;
      description?: string | null;
    }>;
  };

  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }
  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return Response.json(
      { error: "companies array is required and must not be empty" },
      { status: 400 },
    );
  }

  // Verify campaign exists and belongs to the signed-in user (defense in
  // depth).
  const [campaignRow] = await adminDb
    .select({
      id: schema.campaigns.id,
      clerkUserId: schema.campaigns.clerkUserId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  if (!campaignRow) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaignRow.clerkUserId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch existing domains already linked to this campaign
  const existingLinks = await adminDb
    .select({ domain: schema.organizations.domain })
    .from(schema.campaignOrganizations)
    .leftJoin(
      schema.organizations,
      eq(schema.campaignOrganizations.organizationId, schema.organizations.id),
    )
    .where(eq(schema.campaignOrganizations.campaignId, campaignId));

  const existingDomains = new Set(
    existingLinks.map((l) => l.domain).filter((d): d is string => d !== null),
  );

  const seenDomains = new Set<string>();
  let imported = 0;
  let skipped = 0;
  const stagedLinkIds: string[] = [];

  for (const company of companies) {
    if (!company.name?.trim()) {
      skipped++;
      continue;
    }

    let domain: string | null = company.domain?.trim() || null;

    // Extract domain from URL if no domain provided
    if (!domain && company.url) {
      try {
        domain = new URL(
          company.url.startsWith("http")
            ? company.url
            : `https://${company.url}`,
        ).hostname;
      } catch {
        // skip
      }
    }

    // Normalize domain
    if (domain) {
      domain = normalizeDomain(domain);
    }

    // Dedup by domain within campaign
    if (domain && (existingDomains.has(domain) || seenDomains.has(domain))) {
      skipped++;
      continue;
    }
    if (domain) seenDomains.add(domain);

    const org = await findOrCreateOrganization({
      name: company.name.trim(),
      domain,
      url: company.url?.trim() || (domain ? `https://${domain}` : null),
      industry: company.industry?.trim() || null,
      location: company.location?.trim() || null,
      description: company.description?.trim() || null,
      source: "csv",
    });

    const link = await linkOrganizationToCampaign(org.id, campaignId);
    stagedLinkIds.push(link.id);
    imported++;
  }

  // Auto-kick contact-finding for every uploaded company — a list of companies
  // in should produce people out, automatically. Worker-processed in the
  // background (fair-dispatched + budget-guarded).
  await Promise.allSettled(
    stagedLinkIds.map((id) =>
      enqueueEnrichCompany({ companyId: id, campaignId, userId }),
    ),
  );

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: userId,
    event: "csv_import_completed",
    properties: {
      campaign_id: campaignId,
      imported,
      skipped,
      total: companies.length,
    },
  });

  return Response.json({ imported, skipped });
}
