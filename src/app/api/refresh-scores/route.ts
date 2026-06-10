import { getModelSync as getModel } from "@/lib/ai/provider";
import { generateObject } from "ai";
import { z } from "zod";

import { getProfileForPrompt } from "@/lib/profile";
import { withAction } from "@/lib/services/cost-tracker";
import { recordAiUsage } from "@/lib/ai/usage";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

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

  const { campaignId } = body as { campaignId: string };
  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }

  // Fetch campaign ICP (also serves as ownership check -- defense in depth
  // layered on top of application-level scoping)
  const [campaign] = await adminDb
    .select({
      name: schema.campaigns.name,
      icp: schema.campaigns.icp,
      offering: schema.campaigns.offering,
      positioning: schema.campaigns.positioning,
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

  return withAction(`Score contacts: ${campaign.name}`, async () => {
    // Fetch campaign_people linked to enriched people, with org join
    const links = await adminDb
      .select({
        id: schema.campaignPeople.id,
        personId: schema.campaignPeople.personId,
        person: {
          id: schema.people.id,
          name: schema.people.name,
          title: schema.people.title,
          linkedinUrl: schema.people.linkedinUrl,
          twitterUrl: schema.people.twitterUrl,
          enrichmentData: schema.people.enrichmentData,
          enrichmentStatus: schema.people.enrichmentStatus,
        },
        org: {
          name: schema.organizations.name,
          domain: schema.organizations.domain,
          industry: schema.organizations.industry,
          enrichmentData: schema.organizations.enrichmentData,
        },
      })
      .from(schema.campaignPeople)
      .innerJoin(
        schema.people,
        eq(schema.campaignPeople.personId, schema.people.id),
      )
      .leftJoin(
        schema.organizations,
        eq(schema.people.organizationId, schema.organizations.id),
      )
      .where(eq(schema.campaignPeople.campaignId, campaignId));

    // Filter to only enriched people
    const enrichedLinks = links.filter(
      (l) => l.person.enrichmentStatus === "enriched",
    );

    if (enrichedLinks.length === 0) {
      return Response.json({
        scored: 0,
        message: "No enriched contacts to score",
      });
    }

    const profile = await getProfileForPrompt(campaignId);

    // Build a compact summary of each contact for scoring
    const contactSummaries = enrichedLinks.map((l) => {
      const enrichment = l.person.enrichmentData as Record<
        string,
        unknown
      > | null;

      const summary: Record<string, unknown> = {
        id: l.id, // campaign_people link ID
        name: l.person.name,
        title: l.person.title,
        company: l.org?.name || "Unknown",
        industry: l.org?.industry || null,
      };

      // Include LinkedIn headline and recent post topics
      const linkedin = enrichment?.linkedin as {
        profileInfo?: { headline?: string };
        posts?: Array<{ text: string }>;
      } | null;
      if (linkedin?.profileInfo?.headline) {
        summary.headline = linkedin.profileInfo.headline;
      }
      if (linkedin?.posts && linkedin.posts.length > 0) {
        summary.recentPostTopics = linkedin.posts
          .slice(0, 3)
          .map((p) => p.text.slice(0, 150));
      }

      // Include Twitter bio
      const twitter = enrichment?.twitter as {
        user?: { description?: string; followers_count?: number };
      } | null;
      if (twitter?.user?.description) {
        summary.twitterBio = twitter.user.description;
      }

      return summary;
    });

    // Build the scoring prompt
    const profileContext = profile
      ? `User Profile:\n- Name: ${profile.name || "N/A"}\n- Role: ${profile.role_title || "N/A"}\n- Company: ${profile.company_name || "N/A"}\n- Offering: ${profile.offering_summary || "N/A"}\n- Notes: ${profile.notes || "N/A"}`
      : "No user profile available.";

    const startedAt = Date.now();
    const result = await generateObject({
      model: getModel(),
      schema: z.object({
        scores: z.array(
          z.object({
            id: z.string().describe("Campaign-people link ID"),
            score: z.number().min(1).max(10).describe("Priority score 1-10"),
            reason: z
              .string()
              .describe(
                "2-3 sentence reason explaining why to reach out to this person, referencing specific signals",
              ),
          }),
        ),
      }),
      // Cache the schema + tool bindings generated from `schema`. Cross-call
      // cache hits only kick in when a rescore lands within ~5 min of the
      // previous one, but when batches land together this saves 90% on the
      // scoring-schema overhead.
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
      prompt: `Score each contact's outreach priority from 1-10 based on these dimensions:

- **Personal Connection** -- Shared industry/background with the user, mutual topics in posts, geographic proximity
- **Timing Signals** -- Recent job change, relevant recent posts, company news
- **Role Fit** -- Title matches ICP target titles, decision-making authority
- **Reachability** -- Active on social, publishes content

8-10: Strong personal connection angle + recent timing signal. Contact first.
5-7: Good role fit, some personalization hooks but no urgent signal.
1-4: Poor fit or unreachable.

The reason must answer "why reach out to this person NOW" with specific data points.

${UNTRUSTED_NOTICE}

User profile context:
${wrapUntrusted(profileContext)}

Campaign: ${stringify(campaign.name)}
ICP: ${wrapUntrusted(JSON.stringify(campaign.icp))}
Offering: ${wrapUntrusted(JSON.stringify(campaign.offering))}

Contacts to score (enrichment data scraped from LinkedIn, Twitter, news):
${wrapUntrusted(JSON.stringify(contactSummaries, null, 2))}`,
    });

    recordAiUsage(result, {
      operation: "score-contacts",
      costModel: "sonnet",
      startedAt,
      metadata: {
        model: "claude-sonnet-4",
        contactsScored: result.object.scores.length,
        cache_creation_tokens: result.usage.inputTokenDetails?.cacheWriteTokens,
        cache_read_tokens: result.usage.inputTokenDetails?.cacheReadTokens,
      },
      campaignId,
      userId,
    });

    // Batch update scores on campaign_people junction table
    await Promise.all(
      result.object.scores.map((s) =>
        adminDb
          .update(schema.campaignPeople)
          .set({
            priorityScore: String(s.score),
            scoreReason: s.reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.campaignPeople.id, s.id)),
      ),
    );

    return Response.json({
      scored: result.object.scores.length,
      scores: result.object.scores,
    });
  }); // end withAction
}
