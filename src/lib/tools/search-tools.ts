import { tool } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminDb as db } from "@/lib/db/admin";
import { schema } from "@/db";

export const getCompanies = tool({
  description:
    "Fetch stored companies for a campaign, with optional filtering by status. Returns a THIN list (no enrichment_data) so context stays small. For deep detail on one company, call getCompanyDetail(organizationId).",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    status: z
      .enum(["discovered", "qualified", "disqualified"])
      .optional()
      .describe("Filter by company status"),
  }),
  execute: async (input) => {
    const rows = await db
      .select({
        id: schema.campaignOrganizations.id,
        organizationId: schema.campaignOrganizations.organizationId,
        campaignId: schema.campaignOrganizations.campaignId,
        relevanceScore: schema.campaignOrganizations.relevanceScore,
        scoreReason: schema.campaignOrganizations.scoreReason,
        status: schema.campaignOrganizations.status,
        createdAt: schema.campaignOrganizations.createdAt,
        updatedAt: schema.campaignOrganizations.updatedAt,
        org: schema.organizations,
      })
      .from(schema.campaignOrganizations)
      .innerJoin(
        schema.organizations,
        eq(
          schema.campaignOrganizations.organizationId,
          schema.organizations.id,
        ),
      )
      .where(
        input.status
          ? eq(schema.campaignOrganizations.campaignId, input.campaignId)
          : eq(schema.campaignOrganizations.campaignId, input.campaignId),
      )
      .orderBy(schema.campaignOrganizations.relevanceScore);

    const companies = rows
      .filter((r) => !input.status || r.status === input.status)
      .map((row) => ({
        id: row.id,
        organization_id: row.organizationId,
        campaign_id: row.campaignId,
        name: row.org.name,
        domain: row.org.domain,
        url: row.org.url,
        industry: row.org.industry,
        location: row.org.location,
        description: row.org.description,
        enrichment_status: row.org.enrichmentStatus,
        relevance_score: row.relevanceScore,
        score_reason: row.scoreReason,
        status: row.status,
        source: row.org.source,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }));

    return { companies };
  },
});

export const getCompanyDetail = tool({
  description:
    "Fetch full enrichment detail for ONE company (website extract, Exa results, team data). Use when drafting email content that references the company specifically. Call per-draft, not in a loop.",
  inputSchema: z.object({
    organizationId: z
      .string()
      .uuid()
      .describe("organizations.id (not campaign_organizations.id)."),
  }),
  execute: async ({ organizationId }) => {
    const [data] = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        domain: schema.organizations.domain,
        url: schema.organizations.url,
        industry: schema.organizations.industry,
        location: schema.organizations.location,
        description: schema.organizations.description,
        enrichmentData: schema.organizations.enrichmentData,
        enrichmentStatus: schema.organizations.enrichmentStatus,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (!data) {
      return { error: `Company not found` };
    }

    return data;
  },
});

export const getCampaignSummary = tool({
  description:
    "Get summary stats for a campaign: companies found, contacts enriched, status breakdown.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
  }),
  execute: async (input) => {
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, input.campaignId))
      .limit(1);

    if (!campaign) throw new Error("Campaign not found");

    const [companies, contacts] = await Promise.all([
      db
        .select({
          id: schema.campaignOrganizations.id,
          status: schema.campaignOrganizations.status,
        })
        .from(schema.campaignOrganizations)
        .where(eq(schema.campaignOrganizations.campaignId, input.campaignId)),
      db
        .select({
          id: schema.campaignPeople.id,
          enrichmentStatus: schema.people.enrichmentStatus,
        })
        .from(schema.campaignPeople)
        .innerJoin(
          schema.people,
          eq(schema.campaignPeople.personId, schema.people.id),
        )
        .where(eq(schema.campaignPeople.campaignId, input.campaignId)),
    ]);

    const companyStatusCounts = companies.reduce(
      (acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const contactStatusCounts = contacts.reduce(
      (acc, c) => {
        const status = c.enrichmentStatus || "pending";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      campaign,
      stats: {
        totalCompanies: companies.length,
        companiesByStatus: companyStatusCounts,
        totalContacts: contacts.length,
        contactsByStatus: contactStatusCounts,
      },
    };
  },
});
