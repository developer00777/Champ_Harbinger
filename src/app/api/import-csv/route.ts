import { getPostHogClient } from "@/lib/posthog-server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  findOrCreateOrganization,
  findOrCreatePerson,
  linkOrganizationToCampaign,
  linkPersonToCampaign,
  normalizeDomain,
} from "@/lib/services/knowledge-base";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";

interface InCompany {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  targetTitles?: string[] | null;
}

interface InContact {
  name: string;
  company: string;
  domain?: string | null;
  title?: string | null;
  email?: string | null;
  linkedin?: string | null;
  location?: string | null;
}

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

  const {
    campaignId,
    shape = "companies",
    requiredFields = [],
    budgetCapUsd = null,
    companies,
    contacts,
  } = body as {
    campaignId: string;
    shape?: "companies" | "contacts";
    requiredFields?: string[];
    budgetCapUsd?: number | null;
    companies?: InCompany[];
    contacts?: InContact[];
  };

  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }

  const rows = shape === "contacts" ? contacts : companies;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return Response.json(
      { error: `${shape} array is required and must not be empty` },
      { status: 400 },
    );
  }

  // Verify campaign exists and belongs to the signed-in user (defense in depth).
  const [campaignRow] = await adminDb
    .select({
      id: schema.campaigns.id,
      clerkUserId: schema.campaigns.clerkUserId,
      icp: schema.campaigns.icp,
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

  let imported = 0;
  let skipped = 0;
  // One enrichment task per distinct company link — even for known contacts the
  // waterfall runs at company entry (find + merge), so we dedupe org links.
  const orgLinkIds = new Set<string>();
  // Target titles collected from the file feed the discovery filter (icp).
  const collectedTitles = new Set<string>();

  if (shape === "companies") {
    const seen = new Set<string>();
    for (const company of companies as InCompany[]) {
      if (!company.name?.trim()) {
        skipped++;
        continue;
      }
      let domain = company.domain?.trim() || null;
      if (!domain && company.url) {
        try {
          domain = new URL(
            company.url.startsWith("http")
              ? company.url
              : `https://${company.url}`,
          ).hostname;
        } catch {
          // ignore malformed url
        }
      }
      if (domain) domain = normalizeDomain(domain);
      if (domain && seen.has(domain)) {
        skipped++;
        continue;
      }
      if (domain) seen.add(domain);

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
      orgLinkIds.add(link.id);
      for (const t of company.targetTitles ?? []) {
        const trimmed = t.trim();
        if (trimmed) collectedTitles.add(trimmed);
      }
      imported++;
    }
  } else {
    // Known contacts: stage each person under their company, link both to the
    // campaign, and enqueue company-level enrichment to fill the gaps.
    const seen = new Set<string>();
    for (const c of contacts as InContact[]) {
      if (!c.name?.trim() || !c.company?.trim()) {
        skipped++;
        continue;
      }
      const dedupKey =
        (c.email?.trim() && `email:${c.email.trim().toLowerCase()}`) ||
        (c.linkedin?.trim() && `li:${c.linkedin.trim().toLowerCase()}`) ||
        `nc:${c.name.trim().toLowerCase()}@${c.company.trim().toLowerCase()}`;
      if (seen.has(dedupKey)) {
        skipped++;
        continue;
      }
      seen.add(dedupKey);

      const domain = c.domain?.trim() ? normalizeDomain(c.domain.trim()) : null;
      const org = await findOrCreateOrganization({
        name: c.company.trim(),
        domain,
        url: domain ? `https://${domain}` : null,
        industry: null,
        location: c.location?.trim() || null,
        description: null,
        source: "csv",
      });
      const person = await findOrCreatePerson({
        name: c.name.trim(),
        title: c.title?.trim() || null,
        work_email: c.email?.trim() || null,
        linkedin_url: c.linkedin?.trim() || null,
        organization_id: org.id,
        source: "csv",
      });
      await linkPersonToCampaign(person.id, campaignId);
      const link = await linkOrganizationToCampaign(org.id, campaignId);
      orgLinkIds.add(link.id);
      if (c.title?.trim()) collectedTitles.add(c.title.trim());
      imported++;
    }
  }

  // Persist the per-job settings + any target titles onto the campaign ICP so
  // discovery filters by them and the waterfall knows the completeness bar.
  const prevIcp = (campaignRow.icp ?? {}) as Record<string, unknown>;
  const prevTitles = Array.isArray(prevIcp.targetTitles)
    ? (prevIcp.targetTitles as string[])
    : [];
  const mergedTitles = Array.from(new Set([...prevTitles, ...collectedTitles]));
  await adminDb
    .update(schema.campaigns)
    .set({
      icp: {
        ...prevIcp,
        ingestShape: shape,
        requiredFields: Array.isArray(requiredFields) ? requiredFields : [],
        budgetCapUsd:
          typeof budgetCapUsd === "number" && Number.isFinite(budgetCapUsd)
            ? budgetCapUsd
            : null,
        ...(mergedTitles.length > 0 ? { targetTitles: mergedTitles } : {}),
      },
    })
    .where(eq(schema.campaigns.id, campaignId));

  // Auto-kick enrichment for every staged company — a list in produces enriched
  // people out, automatically. Worker-processed (fair-dispatched + budget-gated).
  await Promise.allSettled(
    Array.from(orgLinkIds).map((id) =>
      enqueueEnrichCompany({ companyId: id, campaignId, userId }),
    ),
  );

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: userId,
    event: "csv_import_completed",
    properties: {
      campaign_id: campaignId,
      shape,
      imported,
      skipped,
      total: rows.length,
    },
  });

  return Response.json({ imported, skipped });
}
