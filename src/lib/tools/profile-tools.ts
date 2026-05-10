import { tool } from "ai";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

export const updateUserProfile = tool({
  description:
    "Create or update a user profile. Include `profileId` to update a specific profile, or omit it to create a new one. Each campaign can have its own profile so the user can sell different things to different audiences.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Profile ID to update. Omit to create a new profile."),
    label: z
      .string()
      .optional()
      .describe(
        "Short label to distinguish this profile, e.g. 'SaaS Sales' or 'Consulting'",
      ),
    name: z.string().optional().describe("User's full name"),
    email: z.string().email().optional().describe("User's email address"),
    role_title: z.string().optional().describe("User's job title / role"),
    company_name: z.string().optional().describe("User's company name"),
    company_url: z.string().url().optional().describe("Company website URL"),
    personal_url: z.string().url().optional().describe("Personal website URL"),
    linkedin_url: z.string().optional().describe("LinkedIn profile URL"),
    twitter_url: z.string().optional().describe("Twitter/X profile URL"),
    offering_summary: z
      .string()
      .optional()
      .describe(
        "What the user is selling -- product/service description, problem solved, target market",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Additional context -- target market details, differentiators, constraints, tone preferences",
      ),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();
    const { profileId, ...rest } = input;

    const fields: Partial<typeof schema.userProfile.$inferInsert> = {};
    if (rest.label !== undefined) fields.label = rest.label;
    if (rest.name !== undefined) fields.name = rest.name;
    if (rest.email !== undefined) fields.email = rest.email;
    if (rest.role_title !== undefined) fields.roleTitle = rest.role_title;
    if (rest.company_name !== undefined) fields.companyName = rest.company_name;
    if (rest.company_url !== undefined) fields.companyUrl = rest.company_url;
    if (rest.personal_url !== undefined) fields.personalUrl = rest.personal_url;
    if (rest.linkedin_url !== undefined) fields.linkedinUrl = rest.linkedin_url;
    if (rest.twitter_url !== undefined) fields.twitterUrl = rest.twitter_url;
    if (rest.offering_summary !== undefined)
      fields.offeringSummary = rest.offering_summary;
    if (rest.notes !== undefined) fields.notes = rest.notes;

    if (Object.keys(fields).length === 0) {
      return { error: "No fields provided to update." };
    }

    if (profileId) {
      await sdb.raw
        .update(schema.userProfile)
        .set(fields)
        .where(eq(schema.userProfile.id, profileId));

      const [profile] = await sdb.raw
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, profileId))
        .limit(1);

      return { profile, action: "updated", updated: Object.keys(fields) };
    }

    // Create new profile
    const [profile] = await sdb.raw
      .insert(schema.userProfile)
      .values({
        ...fields,
        clerkUserId: sdb.userId,
        clerkOrgId: sdb.orgId,
      })
      .returning();

    if (!profile) throw new Error("Failed to create profile");
    return { profile, action: "created", updated: Object.keys(fields) };
  },
});

export const getUserProfile = tool({
  description:
    "Get a user profile. Pass a campaignId to get the profile linked to that campaign, or a profileId to get a specific profile. Omit both to get the most recent profile.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Specific profile ID to fetch."),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID -- returns the profile linked to this campaign."),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    // By specific profile ID
    if (input.profileId) {
      const [data] = await sdb.raw
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, input.profileId))
        .limit(1);

      if (!data) throw new Error("Profile not found");
      return { profile: data };
    }

    // By campaign's linked profile
    if (input.campaignId) {
      const [campaign] = await sdb.raw
        .select({ profileId: schema.campaigns.profileId })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.campaignId))
        .limit(1);

      if (campaign?.profileId) {
        const [data] = await sdb.raw
          .select()
          .from(schema.userProfile)
          .where(eq(schema.userProfile.id, campaign.profileId))
          .limit(1);

        if (data) return { profile: data };
      }

      return {
        profile: null,
        message:
          "No profile linked to this campaign. Use listProfiles to see available profiles, or create one with updateUserProfile.",
      };
    }

    // Fallback: most recent profile for this user
    const [data] = await sdb.raw
      .select()
      .from(schema.userProfile)
      .where(sdb.scope(schema.userProfile))
      .orderBy(desc(schema.userProfile.createdAt))
      .limit(1);

    if (!data) {
      return {
        profile: null,
        message:
          "No profile set up yet. Ask the user to fill in a profile so you can personalize outreach.",
      };
    }

    return { profile: data };
  },
});

export const listProfiles = tool({
  description:
    "List all user profiles. Each profile represents a different seller identity the user can link to campaigns.",
  inputSchema: z.object({}),
  execute: async () => {
    const sdb = await getScopedDb();

    const data = await sdb.raw
      .select()
      .from(schema.userProfile)
      .where(sdb.scope(schema.userProfile))
      .orderBy(desc(schema.userProfile.createdAt));

    return { profiles: data };
  },
});
