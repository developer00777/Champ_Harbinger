import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { withAction } from "@/lib/services/cost-tracker";
import { composeEmail, mapConcurrent } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { saveDraft } from "@/lib/email-composition/save";

export const maxDuration = 120;

/**
 * Quick-Start "Draft personalized messages" step.
 *
 * Body: { campaignId, contactIds }. `contactIds` are campaign_people.id values
 * (the `id` field returned by GET /api/campaigns/[id] contacts). For each
 * contact we load the person + org + campaign + sender profile, build the EXACT
 * composeEmail input shape (see lib/email-composition/skill.ts), compose with
 * DeepSeek (Models.personalization), then persist each via saveDraft — the same
 * path the writeEmail tool uses (email_drafts insert).
 *
 * Session-auth + ownership, mirroring find-contacts / enrich-company/bulk.
 */
export async function POST(request: Request) {
  let userId: string;
  let orgId: string | null;
  try {
    ({ userId, orgId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { campaignId, contactIds } = body as {
    campaignId?: string;
    contactIds?: string[];
  };

  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }
  if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
    return Response.json(
      { error: "contactIds is required and must not be empty" },
      { status: 400 },
    );
  }

  // Load campaign (ownership check + context for composeEmail).
  const [campaign] = await adminDb
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      icp: schema.campaigns.icp,
      offering: schema.campaigns.offering,
      positioning: schema.campaigns.positioning,
      profileId: schema.campaigns.profileId,
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

  // Resolve the supplied campaign_people ids → person rows, scoped to THIS
  // campaign (so a caller can't draft for contacts in another user's campaign).
  const cpRows = await adminDb
    .select({
      cpId: schema.campaignPeople.id,
      personId: schema.people.id,
      name: schema.people.name,
      title: schema.people.title,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
      linkedinUrl: schema.people.linkedinUrl,
      enrichmentData: schema.people.enrichmentData,
      organizationId: schema.people.organizationId,
    })
    .from(schema.campaignPeople)
    .innerJoin(
      schema.people,
      eq(schema.campaignPeople.personId, schema.people.id),
    )
    .where(
      and(
        eq(schema.campaignPeople.campaignId, campaignId),
        inArray(schema.campaignPeople.id, contactIds),
      ),
    );

  if (cpRows.length === 0) {
    return Response.json(
      { error: "No matching contacts found in this campaign" },
      { status: 404 },
    );
  }

  // Load the organizations referenced by these contacts in one query.
  const orgIds = [
    ...new Set(
      cpRows
        .map((r) => r.organizationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const orgRows = orgIds.length
    ? await adminDb
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          domain: schema.organizations.domain,
          industry: schema.organizations.industry,
          enrichmentData: schema.organizations.enrichmentData,
        })
        .from(schema.organizations)
        .where(inArray(schema.organizations.id, orgIds))
    : [];
  const orgMap = new Map(orgRows.map((o) => [o.id, o]));

  // Sender profile — same loader semantics as the chat/sequence path: prefer the
  // campaign's linked profile, falling back to the user's most recent profile.
  let profile: {
    name: string | null;
    roleTitle: string | null;
    companyName: string | null;
    notes: string | null;
  } | null = null;
  {
    if (campaign.profileId) {
      const [p] = await adminDb
        .select({
          name: schema.userProfile.name,
          roleTitle: schema.userProfile.roleTitle,
          companyName: schema.userProfile.companyName,
          notes: schema.userProfile.notes,
        })
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, campaign.profileId))
        .limit(1);
      profile = p ?? null;
    }
    if (!profile) {
      const [p] = await adminDb
        .select({
          name: schema.userProfile.name,
          roleTitle: schema.userProfile.roleTitle,
          companyName: schema.userProfile.companyName,
          notes: schema.userProfile.notes,
        })
        .from(schema.userProfile)
        .where(eq(schema.userProfile.clerkUserId, userId))
        .orderBy(schema.userProfile.createdAt)
        .limit(1);
      profile = p ?? null;
    }
  }

  const activeSkills = await loadActiveEmailSkills({
    userId,
    profileId: campaign.profileId ?? null,
    campaignId: campaign.id,
  });

  return withAction(`Quick-Start draft: ${campaign.name}`, async () => {
    const results = await mapConcurrent(cpRows, 4, async (contact) => {
      const email = contact.workEmail ?? contact.personalEmail;
      if (!email) {
        return {
          contactId: contact.cpId,
          personId: contact.personId,
          ok: false as const,
          error: "No email address on this contact.",
        };
      }

      const org = contact.organizationId
        ? orgMap.get(contact.organizationId)
        : undefined;

      const composed = await composeEmail({
        skills: activeSkills,
        contact: {
          name: contact.name ?? null,
          title: contact.title ?? null,
          email,
          enrichmentData:
            (contact.enrichmentData as Record<string, unknown> | null) ?? null,
        },
        company: org
          ? {
              name: org.name ?? null,
              domain: org.domain ?? null,
              industry: org.industry ?? null,
              enrichmentData:
                (org.enrichmentData as Record<string, unknown> | null) ?? null,
            }
          : null,
        step: {
          stepNumber: 1,
          totalSteps: 1,
          condition: "initial",
          isFinal: false,
        },
        campaign: {
          name: campaign.name,
          icp: (campaign.icp as Record<string, unknown> | null) ?? null,
          offering: (campaign.offering as Record<string, unknown> | null) ?? null,
          positioning:
            (campaign.positioning as Record<string, unknown> | null) ?? null,
        },
        senderProfile: {
          name: profile?.name ?? null,
          title: profile?.roleTitle ?? null,
          company: profile?.companyName ?? null,
          signature: profile?.notes ?? null,
        },
        triggerReason: null,
      });

      if (!composed.ok) {
        return {
          contactId: contact.cpId,
          personId: contact.personId,
          ok: false as const,
          error: composed.error,
        };
      }

      const saved = await saveDraft({
        userId,
        orgId,
        campaignId: campaign.id,
        personId: contact.personId,
        subject: composed.email.subject,
        bodyHtml: composed.email.bodyHtml,
        bodyText: composed.email.bodyText,
        aiReasoning: composed.email.aiReasoning,
      });

      if (!saved.ok) {
        return {
          contactId: contact.cpId,
          personId: contact.personId,
          ok: false as const,
          error: saved.error,
        };
      }

      return {
        ok: true as const,
        id: saved.draftId,
        contactId: contact.cpId,
        personId: contact.personId,
        contact: {
          name: contact.name,
          title: contact.title,
          email,
          company: org?.name ?? null,
        },
        subject: composed.email.subject,
        bodyHtml: composed.email.bodyHtml,
        bodyText: composed.email.bodyText,
      };
    });

    const drafts = results.filter((r) => r.ok);
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({ contactId: r.contactId, error: r.error }));

    return Response.json({
      drafts,
      failures,
      total: cpRows.length,
      saved: drafts.length,
    });
  });
}
