import { eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { getDiscoveryProvider } from "@/lib/discovery";
import { enqueueEnrichCompany } from "@/lib/jobs/boss";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
} from "@/lib/services/knowledge-base";

/**
 * The Quick-Start discovery pipeline, extracted from the route handler so the
 * pg-boss worker can own it.
 *
 * Why it moved: this is a long, heavy fan-out — LLM query generation, SearXNG
 * search, fetching dozens of homepages, LLM-normalising each, then ICP
 * verification. Run inline in the API process it routinely exceeded five
 * minutes, and on a 512 MiB / 0.75 CPU container it starved the whole backend:
 * a single discovery request made every other route (/api/campaigns,
 * /api/dashboard, /api/me/provision) return 504 until it finished. Killing the
 * request restored the API instantly, which is what proved the causality.
 *
 * The route now enqueues; the worker runs this. The worker exists for exactly
 * this kind of work and is fair-dispatched and budget-guarded already.
 */

export interface RunDiscoveryInput {
  criteria: string;
  userId: string;
  campaignId?: string | null;
  limit?: number;
}

export interface StagedCompany {
  /** campaign_organizations.id — the companyId find-contacts wants. */
  id: string;
  organizationId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
}

export interface RunDiscoveryResult {
  companies: Array<{
    name: string;
    domain: string | null;
    url: string | null;
    industry: string | null;
    location: string | null;
    description: string | null;
    score: number;
    score_reason: string;
  }>;
  campaignId: string | null;
  imported: number;
  skipped: number;
  staged: StagedCompany[];
  contactFindingQueued: number;
  mock?: true;
  warning?: string;
}

export async function runQuickStartDiscovery({
  criteria,
  userId,
  campaignId,
  limit = 200,
}: RunDiscoveryInput): Promise<RunDiscoveryResult> {
  const provider = await getDiscoveryProvider(userId);
  const usesMockData = (await provider.usesMockData?.()) ?? false;
  const verified = await provider.discoverCompanies(criteria.trim(), limit);

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
  const staged: StagedCompany[] = [];

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
  // companies should get their people found automatically — that's the point.
  // The worker processes these ~5 at a time (fair-dispatched, budget-guarded);
  // contacts stream into the campaign without per-company clicks.
  if (campaignId && staged.length > 0) {
    await Promise.allSettled(
      staged.map((s) =>
        enqueueEnrichCompany({ companyId: s.id, campaignId, userId }),
      ),
    );
  }

  return {
    companies,
    campaignId: campaignId ?? null,
    imported,
    skipped,
    staged,
    contactFindingQueued: campaignId ? staged.length : 0,
    // Never let fixture data pass for real leads.
    ...(usesMockData
      ? {
          mock: true as const,
          warning:
            "MOCK DATA — no LakeB2B key and no SEARXNG_URL configured. " +
            "These are built-in fixture companies, not real results.",
        }
      : {}),
  };
}

/** Ownership check shared by the enqueueing route. */
export async function assertCampaignOwned(
  campaignId: string,
  userId: string,
): Promise<"ok" | "not_found" | "forbidden"> {
  const [campaign] = await adminDb
    .select({ clerkUserId: schema.campaigns.clerkUserId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return "not_found";
  if (campaign.clerkUserId !== userId) return "forbidden";
  return "ok";
}
