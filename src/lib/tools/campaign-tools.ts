import { tool } from "ai";
import { z } from "zod";
import { desc, eq, count } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

export const saveCampaign = tool({
  description:
    "Save or update a campaign with ICP definition, offering, positioning, and search criteria. Use this to persist the user's outbound campaign configuration.",
  inputSchema: z.object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to update. Omit to create a new campaign."),
    name: z.string().min(1).describe("Campaign name"),
    status: z
      .enum(["discovery", "researching", "active", "paused", "completed"])
      .optional()
      .describe("Campaign status"),
    icp: z
      .object({
        industry: z.string().optional(),
        companySize: z.string().optional(),
        geography: z.string().optional(),
        targetTitles: z.array(z.string()).optional(),
        painPoints: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Ideal Customer Profile definition"),
    offering: z
      .object({
        description: z.string().optional(),
        valueProposition: z.string().optional(),
        differentiators: z.array(z.string()).optional(),
      })
      .optional()
      .describe("What the user is selling/offering"),
    positioning: z
      .object({
        angle: z.string().optional(),
        tone: z.string().optional(),
        keyMessages: z.array(z.string()).optional(),
      })
      .optional()
      .describe("How to position the outreach"),
    searchCriteria: z
      .object({
        queries: z.array(z.string()).optional(),
        categories: z.array(z.string()).optional(),
        excludeDomains: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Search criteria for finding companies"),
    notes: z.string().optional().describe("Free-form notes about the campaign"),
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "User profile ID to link to this campaign. Each campaign can have its own seller profile.",
      ),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    if (input.id) {
      const updateData: Partial<typeof schema.campaigns.$inferInsert> = {
        name: input.name,
      };
      if (input.status) updateData.status = input.status;
      if (input.icp) updateData.icp = input.icp as Record<string, unknown>;
      if (input.offering) updateData.offering = input.offering as Record<string, unknown>;
      if (input.positioning) updateData.positioning = input.positioning as Record<string, unknown>;
      if (input.searchCriteria) updateData.searchCriteria = input.searchCriteria as Record<string, unknown>;
      if (input.notes !== undefined) updateData.notes = input.notes;
      if (input.profileId !== undefined) updateData.profileId = input.profileId;

      const [data] = await sdb.raw
        .update(schema.campaigns)
        .set(updateData)
        .where(eq(schema.campaigns.id, input.id))
        .returning();

      if (!data) throw new Error("Failed to update campaign: not found");
      return { campaign: data, action: "updated" };
    }

    const [data] = await sdb.raw
      .insert(schema.campaigns)
      .values({
        name: input.name,
        status: input.status || "discovery",
        icp: (input.icp || {}) as Record<string, unknown>,
        offering: (input.offering || {}) as Record<string, unknown>,
        positioning: (input.positioning || {}) as Record<string, unknown>,
        searchCriteria: (input.searchCriteria || {}) as Record<string, unknown>,
        notes: input.notes,
        profileId: input.profileId || null,
        clerkUserId: sdb.userId,
        clerkOrgId: sdb.orgId,
      })
      .returning();

    if (!data) throw new Error("Failed to create campaign");
    return { campaign: data, action: "created" };
  },
});

export const getCampaign = tool({
  description:
    "Retrieve a campaign by ID, or get the most recently updated campaign if no ID is provided.",
  inputSchema: z.object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID. Omit to get the most recent campaign."),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    if (input.id) {
      const [data] = await sdb.raw
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.id))
        .limit(1);

      if (!data) throw new Error("Campaign not found");
      return { campaign: data };
    }

    const [data] = await sdb.raw
      .select()
      .from(schema.campaigns)
      .where(sdb.scope(schema.campaigns))
      .orderBy(desc(schema.campaigns.updatedAt))
      .limit(1);

    if (!data) throw new Error("No campaigns found");
    return { campaign: data };
  },
});

export const listCampaigns = tool({
  description: "List all campaigns with summary stats.",
  inputSchema: z.object({}),
  execute: async () => {
    const sdb = await getScopedDb();

    const campaigns = await sdb.raw
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
        profileId: schema.campaigns.profileId,
        createdAt: schema.campaigns.createdAt,
        updatedAt: schema.campaigns.updatedAt,
      })
      .from(schema.campaigns)
      .where(sdb.scope(schema.campaigns))
      .orderBy(desc(schema.campaigns.updatedAt));

    // Get counts per campaign
    const orgsCount = await sdb.raw
      .select({
        campaignId: schema.campaignOrganizations.campaignId,
        cnt: count(),
      })
      .from(schema.campaignOrganizations)
      .groupBy(schema.campaignOrganizations.campaignId);

    const peopleCount = await sdb.raw
      .select({
        campaignId: schema.campaignPeople.campaignId,
        cnt: count(),
      })
      .from(schema.campaignPeople)
      .groupBy(schema.campaignPeople.campaignId);

    const orgsMap = Object.fromEntries(orgsCount.map((r) => [r.campaignId, r.cnt]));
    const peopleMap = Object.fromEntries(peopleCount.map((r) => [r.campaignId, r.cnt]));

    const campaignsWithStats = campaigns.map((c) => ({
      ...c,
      companyCount: orgsMap[c.id] ?? 0,
      contactCount: peopleMap[c.id] ?? 0,
    }));

    return { campaigns: campaignsWithStats };
  },
});
