import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
  normalizeDomain,
} from "@/lib/services/knowledge-base";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";

export const maxDuration = 60;

interface InCompany {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
}

/**
 * Champ Sets → ChampHarbinger 1-click push (companies).
 *
 * Land a LIST OF COMPANIES into a campaign and automatically find people in
 * each — worker-processed: team-page scrape + LinkedIn/web search, role-
 * filtered (targetTitles), with the domain auto-resolved for name-only rows.
 * API-key authenticated (chh_ key, not a Clerk session).
 *
 * POST { campaignName?, campaignId?, targetTitles?, companies: [{ name, domain? }] }
 *   → { campaignId, imported, skipped, contactFindingQueued }
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }
  const userId = ctx.userId;

  let body: {
    campaignName?: string;
    campaignId?: string;
    targetTitles?: string[];
    companies?: InCompany[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const companies = (body.companies ?? []).filter((c) => c?.name?.trim());
  if (companies.length === 0) {
    return NextResponse.json(
      { error: "companies is required and must contain at least one { name }" },
      { status: 400 },
    );
  }

  // Resolve the target campaign: verify an existing one, or create a new one
  // (with the requested target roles baked into its ICP).
  let campaignId: string;
  if (body.campaignId) {
    const [c] = await adminDb
      .select({ clerkUserId: schema.campaigns.clerkUserId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, body.campaignId))
      .limit(1);
    if (!c) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }
    if (c.clerkUserId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    campaignId = body.campaignId;
  } else {
    const targetTitles = (body.targetTitles ?? [])
      .map((t) => t.trim())
      .filter(Boolean);
    const [created] = await adminDb
      .insert(schema.campaigns)
      .values({
        clerkUserId: userId,
        name: body.campaignName?.trim() || "Champ Sets import",
        status: "active",
        icp: targetTitles.length > 0 ? { targetTitles } : {},
        offering: {},
        positioning: {},
        searchCriteria: { source: "champ_sets" },
      })
      .returning({ id: schema.campaigns.id });
    campaignId = created.id;
  }

  // Stage companies (dedup by domain), then auto-kick contact-finding.
  let imported = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const stagedLinkIds: string[] = [];

  for (const c of companies) {
    let domain = c.domain?.trim() || null;
    if (!domain && c.url) {
      try {
        domain = new URL(c.url.startsWith("http") ? c.url : `https://${c.url}`)
          .hostname;
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
      name: c.name.trim(),
      domain,
      url: c.url?.trim() || (domain ? `https://${domain}` : null),
      industry: c.industry?.trim() || null,
      location: c.location?.trim() || null,
      description: null,
      source: "champ_sets",
    });
    const link = await linkOrganizationToCampaign(org.id, campaignId);
    stagedLinkIds.push(link.id);
    imported++;
  }

  await Promise.allSettled(
    stagedLinkIds.map((id) =>
      enqueueEnrichCompany({ companyId: id, campaignId, userId }),
    ),
  );

  return NextResponse.json({
    campaignId,
    imported,
    skipped,
    contactFindingQueued: stagedLinkIds.length,
  });
}
