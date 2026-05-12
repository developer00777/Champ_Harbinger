import { withAction } from "@/lib/services/cost-tracker";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, and } from "drizzle-orm";
import {
  summarizeSearchResults,
  summarizeWebsite,
} from "@/lib/services/enrichment-summarizer";
import { ExaService } from "@/lib/services/exa-service";
import { filterRelevantResults } from "@/lib/services/relevance-filter";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import {
  mergeEnrichmentData,
  isRecentlyEnriched,
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import {
  findPeopleOnDomain,
  filterContactsByCompany,
  type CompanyContext,
  type CandidateContact,
} from "@/lib/services/contact-filter";
import {
  recordVerifiedEmail,
  makeEmailPatternDb,
} from "@/lib/services/email-pattern";
import { parseLinkedInTitle } from "@/lib/utils";

export const maxDuration = 120;

/** Signal slugs that map to company-level enrichment operations */
const SIGNAL_SLUG_PRODUCT = "product-launches";
const SIGNAL_SLUG_FUNDING = "funding-news";
const SIGNAL_SLUG_EXECUTIVE = "executive-changes";
const SIGNAL_SLUG_GOOGLE_REVIEWS = "google-reviews";

/** Returns active signal slugs, or null if signals haven't been configured for this campaign */
async function getActiveSignalSlugs(
  campaignId: string,
): Promise<Set<string> | null> {
  // Check if any campaign_signals records exist at all
  const anySignal = await adminDb
    .select({ id: schema.campaignSignals.id })
    .from(schema.campaignSignals)
    .where(eq(schema.campaignSignals.campaignId, campaignId))
    .limit(1);

  // No signal config at all -- run everything (not configured yet)
  if (anySignal.length === 0) return null;

  const rows = await adminDb
    .select({ slug: schema.signals.slug })
    .from(schema.campaignSignals)
    .innerJoin(
      schema.signals,
      eq(schema.campaignSignals.signalId, schema.signals.id),
    )
    .where(
      and(
        eq(schema.campaignSignals.campaignId, campaignId),
        eq(schema.campaignSignals.enabled, true),
      ),
    );

  return new Set(rows.map((r) => r.slug));
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

  const { companyId, campaignId } = body as {
    companyId: string;
    campaignId?: string;
  };
  if (!companyId) {
    return Response.json({ error: "companyId is required" }, { status: 400 });
  }

  // Defense-in-depth ownership check. If campaignId is supplied, verify
  // it belongs to the signed-in user directly.
  if (campaignId) {
    const [campaignRow] = await adminDb
      .select({ clerkUserId: schema.campaigns.clerkUserId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaignRow) {
      return Response.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaignRow.clerkUserId !== userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Resolve active signal slugs for this campaign
  const activeSlugs = campaignId
    ? await getActiveSignalSlugs(campaignId)
    : null; // null = run all (no campaign context)

  // companyId is a campaign_organizations link ID -- resolve the organization.
  // Join through campaigns.clerk_user_id so we can also verify ownership when
  // campaignId wasn't explicitly supplied.
  const [link] = await adminDb
    .select({
      organizationId: schema.campaignOrganizations.organizationId,
      campaignId: schema.campaignOrganizations.campaignId,
      campaignClerkUserId: schema.campaigns.clerkUserId,
    })
    .from(schema.campaignOrganizations)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaignOrganizations.campaignId, schema.campaigns.id),
    )
    .where(eq(schema.campaignOrganizations.id, companyId))
    .limit(1);

  if (!link) {
    // Try as a direct organization ID.
    const [org] = await adminDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, companyId))
      .limit(1);

    if (!org) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    return enrichOrganization(
      org as unknown as Record<string, unknown>,
      companyId,
      activeSlugs,
      campaignId,
    );
  }

  // Ownership check via the link's parent campaign.
  if (link.campaignClerkUserId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = link.organizationId;

  // Fetch the full organization row
  const [org] = await adminDb
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);

  if (!org) {
    return Response.json(
      { error: "Organization data missing" },
      { status: 404 },
    );
  }

  return enrichOrganization(
    org as unknown as Record<string, unknown>,
    orgId,
    activeSlugs,
    campaignId,
    companyId,
  );
}

async function findContactsForCompany(
  orgId: string,
  company: CompanyContext,
  campaignId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _linkId?: string,
): Promise<{ totalFound: number }> {
  let totalFound = 0;

  const [campaign] = await adminDb
    .select({ icp: schema.campaigns.icp })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  const icp = campaign?.icp as Record<string, unknown> | null;
  const targetTitles = (icp?.targetTitles as string[] | undefined) || [];
  // Bound to avoid per-user Exa spend blowouts.
  const boundedTitles = targetTitles.slice(0, 5);

  // Dedup against existing campaign contacts (by LinkedIn URL only)
  const existingLinks = await adminDb
    .select({ linkedinUrl: schema.people.linkedinUrl })
    .from(schema.campaignPeople)
    .innerJoin(
      schema.people,
      eq(schema.campaignPeople.personId, schema.people.id),
    )
    .where(eq(schema.campaignPeople.campaignId, campaignId));

  const existingUrls = new Set(
    existingLinks
      .map((l) => l.linkedinUrl)
      .filter((u): u is string => u !== null),
  );

  // ── Phase 1: Search the company's own website for team/staff ───────
  if (company.domain) {
    try {
      const domainPeople = await findPeopleOnDomain(
        company.domain,
        company.name,
      );
      for (const dp of domainPeople) {
        if (dp.linkedinUrl && existingUrls.has(dp.linkedinUrl)) continue;

        const person = await findOrCreatePerson({
          name: dp.name,
          title: dp.title,
          linkedin_url: dp.linkedinUrl,
          work_email: dp.email,
          organization_id: orgId,
          source: "website",
        });

        if (dp.email) {
          await recordVerifiedEmail(makeEmailPatternDb(adminDb), {
            personId: person.id,
            email: dp.email,
            source: "team_page",
          });
        }

        await linkPersonToCampaign(person.id, campaignId);
        if (dp.linkedinUrl) existingUrls.add(dp.linkedinUrl);
        totalFound++;
      }
    } catch (err) {
      console.error("[findContactsForCompany] Domain scrape failed:", err);
    }
  }

  // ── Phase 2: LinkedIn search with LLM filtering ────────────────────
  if (boundedTitles.length > 0) {
    const exa = new ExaService();

    const searchResults = await Promise.all(
      boundedTitles.map(async (title: string) => {
        const query = `"${company.name}" ${title} site:linkedin.com`;
        try {
          const result = await exa.search(query, {
            numResults: 3,
            category: "people" as const,
            includeText: true,
          });
          return { title, results: result.results };
        } catch {
          return { title, results: [] };
        }
      }),
    );

    // Collect deduplicated candidates for LLM filtering
    const seenUrls = new Set<string>();
    const candidates: Array<
      CandidateContact & { searchTitle: string; linkedinUrl: string | null }
    > = [];

    for (const search of searchResults) {
      for (const result of search.results) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        const linkedinUrl = result.url.includes("linkedin.com")
          ? result.url
          : null;
        if (linkedinUrl && existingUrls.has(linkedinUrl)) continue;

        const parsed = parseLinkedInTitle(result.title);

        candidates.push({
          name: parsed.name,
          title: parsed.title || search.title,
          linkedinUrl,
          rawHeadline: result.title,
          searchTitle: search.title,
        });
      }
    }

    if (candidates.length > 0) {
      // LLM filter: verify each candidate actually works at this company
      const verified = await filterContactsByCompany(company, candidates);

      for (const v of verified) {
        const candidate = candidates[v.index];
        if (!candidate) continue;

        const person = await findOrCreatePerson({
          name: v.name,
          title: v.title,
          linkedin_url: candidate.linkedinUrl,
          organization_id: orgId,
          source: "exa",
        });

        await linkPersonToCampaign(person.id, campaignId);
        totalFound++;
      }
    }
  }

  return { totalFound };
}

async function enrichOrganization(
  org: Record<string, unknown>,
  orgId: string,
  activeSlugs: Set<string> | null,
  campaignId?: string,
  linkId?: string,
) {
  return withAction(`Enrich company: ${org.name}`, async () => {
    // Check recency
    const recent = await isRecentlyEnriched("organizations", orgId);
    if (recent) {
      // Still find contacts even if enrichment is cached
      let contactsFound = 0;
      if (campaignId) {
        const companyCtx: CompanyContext = {
          name: org.name as string,
          domain: (org.domain as string) || null,
          industry: (org.industry as string) || null,
          location: (org.location as string) || null,
          description: (org.description as string) || null,
        };
        const result = await findContactsForCompany(
          orgId,
          companyCtx,
          campaignId,
          linkId,
        );
        contactsFound = result.totalFound;
      }
      return Response.json({
        companyId: orgId,
        enrichmentData: org.enrichment_data ?? org.enrichmentData,
        skipped: true,
        contactsFound,
      });
    }

    // Website extraction always runs -- it's core enrichment, not a signal.
    // Exa searches are gated by active signals when configured.
    const runProduct = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_PRODUCT);
    const runFunding = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_FUNDING);
    const runExecutive = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_EXECUTIVE);
    const runGoogleReviews =
      !activeSlugs || activeSlugs.has(SIGNAL_SLUG_GOOGLE_REVIEWS);

    const exa = new ExaService();
    const extractor = new WebExtractionService();
    const errors: string[] = [];

    const companyUrl =
      (org.url as string) || (org.domain ? `https://${org.domain}` : null);

    const contextParts: string[] = [];
    if (org.industry) contextParts.push(org.industry as string);
    if (org.location) contextParts.push(org.location as string);
    const context = contextParts.length > 0 ? ` ${contextParts.join(" ")}` : "";
    const domainHint = org.domain ? ` ${org.domain}` : "";
    const specificName = `"${org.name}"${domainHint}${context}`;

    const companyDomain =
      (org.domain as string) ||
      (companyUrl ? new URL(companyUrl).hostname : null);

    // Website extraction always runs; Exa searches gated by signals
    const operations = await Promise.allSettled([
      companyUrl
        ? extractor.extract(companyUrl, { includeLinks: false })
        : Promise.resolve(null),
      runProduct
        ? exa.search(
            companyDomain
              ? `${org.name} products services`
              : `${specificName} product services offering`,
            {
              numResults: 5,
              includeText: true,
              ...(companyDomain ? { includeDomains: [companyDomain] } : {}),
            },
          )
        : Promise.resolve({ results: [] }),
      runFunding
        ? exa.search(`${specificName} funding news announcement`, {
            numResults: 5,
            includeText: true,
            category: "news",
          })
        : Promise.resolve({ results: [] }),
      runExecutive
        ? exa.search(`${specificName} executive leadership team changes`, {
            numResults: 5,
            includeText: true,
          })
        : Promise.resolve({ results: [] }),
      runGoogleReviews
        ? (async () => {
            const { GooglePlacesService } =
              await import("@/lib/services/google-places-service");
            const service = new GooglePlacesService();
            return service.getPlaceReviews(
              org.name as string,
              (org.location as string) || undefined,
              (org.domain as string) || undefined,
            );
          })()
        : Promise.resolve(null),
    ]);

    const [
      websiteResult,
      productResult,
      fundingResult,
      executiveResult,
      googleReviewsResult,
    ] = operations;

    const enrichmentData: Record<string, unknown> = {
      enrichedAt: new Date().toISOString(),
    };

    if (websiteResult.status === "fulfilled" && websiteResult.value?.success) {
      const wd = websiteResult.value.data;
      const summary = await summarizeWebsite({
        companyName: org.name as string,
        title: wd.title,
        description: wd.description,
        content: wd.content,
      });
      enrichmentData.website = {
        title: wd.title,
        description: wd.description,
        content: wd.content.slice(0, 3000),
        summary: summary ?? undefined,
        openGraph: wd.openGraph,
      };
    } else if (websiteResult.status === "rejected") {
      errors.push(`Website: ${websiteResult.reason?.message || "Failed"}`);
    }

    const searches: Array<{
      category: string;
      query: string;
      results: Array<{
        title: string;
        url: string;
        publishedDate: string | null;
        text: string | null;
      }>;
    }> = [];

    const searchEntries: Array<
      [string, boolean, PromiseSettledResult<unknown>]
    > = [
      ["product", runProduct, productResult],
      ["funding", runFunding, fundingResult],
      ["executive", runExecutive, executiveResult],
    ];

    for (const [label, enabled, result] of searchEntries) {
      if (!enabled) continue;
      if (result.status === "fulfilled") {
        const value = result.value as {
          results: Array<{
            title: string;
            url: string;
            publishedDate: string | null;
            text: string | null;
          }>;
        };
        const mapped = value.results.map((r) => ({
          title: r.title,
          url: r.url,
          publishedDate: r.publishedDate,
          text: r.text?.slice(0, 2000) || null,
        }));
        const filtered = await filterRelevantResults(
          org.name as string,
          companyDomain,
          mapped,
        );
        const topResults = filtered.slice(0, 3);
        const summarized = await summarizeSearchResults(
          org.name as string,
          label,
          topResults,
        );
        searches.push({
          category: label,
          query: `${org.name} ${label}`,
          results: summarized,
        });
      } else {
        errors.push(`Search (${label}): ${result.reason?.message || "Failed"}`);
      }
    }

    enrichmentData.searches = searches;

    // Google Reviews
    if (
      googleReviewsResult.status === "fulfilled" &&
      googleReviewsResult.value?.found
    ) {
      const gr = googleReviewsResult.value;
      enrichmentData.googleReviews = {
        rating: gr.rating,
        reviewCount: gr.userRatingCount,
        googleMapsUrl: gr.googleMapsUri,
        topReviews: gr.reviews.slice(0, 5),
        fetchedAt: new Date().toISOString(),
      };
    } else if (googleReviewsResult.status === "rejected") {
      errors.push(
        `Google Reviews: ${googleReviewsResult.reason?.message || "Failed"}`,
      );
    }

    if (errors.length > 0) enrichmentData.errors = errors;

    await mergeEnrichmentData("organizations", orgId, enrichmentData);

    // Also find contacts if we have campaign context
    let contactsFound = 0;
    if (campaignId) {
      try {
        const companyCtx: CompanyContext = {
          name: org.name as string,
          domain: (org.domain as string) || null,
          industry: (org.industry as string) || null,
          location: (org.location as string) || null,
          description: (org.description as string) || null,
        };
        const result = await findContactsForCompany(
          orgId,
          companyCtx,
          campaignId,
          linkId,
        );
        contactsFound = result.totalFound;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        errors.push(`Find contacts: ${msg}`);
      }
    }

    return Response.json({
      companyId: orgId,
      enrichmentData,
      contactsFound,
      errors: errors.length > 0 ? errors : undefined,
    });
  }); // end withAction
}
