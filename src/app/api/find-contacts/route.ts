import { withAction } from "@/lib/services/cost-tracker";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import { findPeopleOnDomain } from "@/lib/services/contact-filter";
import {
  recordVerifiedEmail,
  makeEmailPatternDb,
} from "@/lib/services/email-pattern";

export const maxDuration = 120;

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
    campaignId: string;
  };
  if (!companyId || !campaignId) {
    return Response.json(
      { error: "companyId and campaignId are required" },
      { status: 400 },
    );
  }

  // Get campaign ICP for target titles (also ownership check -- defense in
  // depth)
  const [campaign] = await adminDb
    .select({
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

  const icp = campaign.icp as Record<string, unknown> | null;
  const targetTitles = (icp?.targetTitles as string[] | undefined) || [];

  // companyId is a campaign_organizations link ID -- resolve the organization
  const [link] = await adminDb
    .select({
      organizationId: schema.campaignOrganizations.organizationId,
      org: {
        name: schema.organizations.name,
        domain: schema.organizations.domain,
        industry: schema.organizations.industry,
        location: schema.organizations.location,
        description: schema.organizations.description,
      },
    })
    .from(schema.campaignOrganizations)
    .leftJoin(
      schema.organizations,
      eq(schema.campaignOrganizations.organizationId, schema.organizations.id),
    )
    .where(eq(schema.campaignOrganizations.id, companyId))
    .limit(1);

  if (!link || !link.org?.name) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const orgId = link.organizationId;
  const org = link.org as {
    name: string;
    domain: string | null;
    industry: string | null;
    location: string | null;
    description: string | null;
  };

  return withAction(`Find contacts: ${org.name}`, async () => {
    let totalFound = 0;

    // Dedup against existing people linked to this campaign (by LinkedIn URL)
    const existingLinks = await adminDb
      .select({ linkedinUrl: schema.people.linkedinUrl })
      .from(schema.campaignPeople)
      .leftJoin(
        schema.people,
        eq(schema.campaignPeople.personId, schema.people.id),
      )
      .where(eq(schema.campaignPeople.campaignId, campaignId));

    const existingUrls = new Set(
      existingLinks
        .map((l) => l.linkedinUrl)
        .filter((u): u is string => u !== null),
    );

    const epDb = makeEmailPatternDb(adminDb);

    // ── Phase 1: Search the company's own website for team/staff ───────
    if (org.domain) {
      try {
        const domainPeople = await findPeopleOnDomain(org.domain, org.name);
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
            await recordVerifiedEmail(epDb, {
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
        console.error("[find-contacts] Domain scrape failed:", err);
      }
    }

    return Response.json({
      companyId,
      companyName: org.name,
      totalFound,
      targetTitles,
    });
  }); // end withAction
}
