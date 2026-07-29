import { getCurrentUser } from "@/lib/auth";
import { describeUpstreamError } from "@/lib/api/upstream-error";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { getDiscoveryProvider } from "@/lib/discovery";
import { withAction } from "@/lib/services/cost-tracker";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
} from "@/lib/services/knowledge-base";

export const maxDuration = 60;

/**
 * Quick-Start "Describe criteria" entry point.
 *
 * Reuses the same discovery provider as POST /api/v1/discover
 * (getDiscoveryProvider → AI-verified companies). Session-auth + ownership
 * (mirrors find-contacts / enrich-company/bulk). If `campaignId` is supplied,
 * the verified companies are imported into that campaign (same KB insert path
 * as /api/import-csv) so they're immediately stage-able in the hub.
 */
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

  const { criteria, campaignId } = body as {
    criteria?: string;
    targetType?: string;
    campaignId?: string;
  };

  if (!criteria || !criteria.trim()) {
    return Response.json({ error: "criteria is required" }, { status: 400 });
  }

  // If a campaign is supplied, verify ownership before importing into it.
  if (campaignId) {
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
  }

  // `withAction` is an AsyncLocalStorage .run() — it does NOT catch. Without
  // this wrapper a provider failure (e.g. a rejected OpenRouter key) escapes
  // the handler, Next replies 500 with an empty body, and the client's
  // res.json() throws "Unexpected end of JSON input" — hiding the real cause.
  try {
    return await withAction(
      `Quick-Start discover: ${criteria.slice(0, 60)}`,
      async () => {
        const provider = await getDiscoveryProvider(userId);
        const verified = await provider.discoverCompanies(criteria.trim(), 20);

        // The criteria-verifier is intentionally strict and judges from thin
        // homepage data, so it frequently rejects every real company it found.
        // Quick Start must not come back empty when discovery actually surfaced
        // companies: prefer the verified-passing set, but fall back to the full
        // discovered set (each already cleared the "is a real, relevant company"
        // normalize step) so the user always has companies to work with.
        const passing = verified.filter((co) => co.passes);
        const selected = passing.length > 0 ? passing : verified;

        // Shape mirrors POST /api/v1/discover so the UI gets a stable contract.
        const companies = selected.map((co) => ({
          name: co.name,
          domain: co.domain ?? null,
          url: co.website ?? null,
          industry: co.industry ?? null,
          location: co.location?.country ?? null,
          description: co.description ?? null,
          score: co.funding_stage ? 7 : 5,
          score_reason:
            co.reason ??
            `${co.industry ?? "Company"} in ${co.location?.country ?? "unknown location"}`,
        }));

        // When a campaign is given, import the discovered companies so they become
        // stage-able. Reuse the exact KB path used by /api/import-csv:
        // findOrCreateOrganization (dedup by domain) + linkOrganizationToCampaign.
        let imported = 0;
        let skipped = 0;
        const staged: Array<{
          id: string; // campaign_organizations.id — the companyId find-contacts wants
          organizationId: string;
          name: string;
          domain: string | null;
          industry: string | null;
          location: string | null;
        }> = [];

        if (campaignId) {
          const seenDomains = new Set<string>();
          for (const co of companies) {
            if (!co.name?.trim()) {
              skipped++;
              continue;
            }
            if (co.domain && seenDomains.has(co.domain)) {
              skipped++;
              continue;
            }
            if (co.domain) seenDomains.add(co.domain);

            const org = await findOrCreateOrganization({
              name: co.name.trim(),
              domain: co.domain,
              url: co.url,
              industry: co.industry,
              location: co.location,
              description: co.description,
              source: "quick_start_discover",
            });
            const link = await linkOrganizationToCampaign(org.id, campaignId);
            imported++;
            staged.push({
              id: link.id,
              organizationId: org.id,
              name: org.name,
              domain: org.domain ?? null,
              industry: org.industry ?? null,
              location: org.location ?? null,
            });
          }
        }

        // Auto-kick contact-finding for everything we just staged. Incoming
        // companies should get their people found automatically — that's the
        // point. The worker processes these ~5 at a time (fair-dispatched, budget
        // -guarded); contacts stream into the campaign without per-company clicks.
        if (campaignId && staged.length > 0) {
          await Promise.allSettled(
            staged.map((s) =>
              enqueueEnrichCompany({ companyId: s.id, campaignId, userId }),
            ),
          );
        }

        return Response.json({
          companies,
          campaignId: campaignId ?? null,
          imported,
          skipped,
          staged,
          contactFindingQueued: campaignId ? staged.length : 0,
        });
      },
    );
  } catch (err) {
    console.error("[quick-start/discover] failed:", err);
    const { status, body } = describeUpstreamError(err);
    return Response.json(body, { status });
  }
}
