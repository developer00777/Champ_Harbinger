import { NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";

import { composeEmail } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

export const maxDuration = 120;

interface Body {
  draftId?: string;
}

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  // Load draft — scoped to this user
  const [draft] = await adminDb
    .select({
      id: schema.emailDrafts.id,
      clerkUserId: schema.emailDrafts.clerkUserId,
      campaignId: schema.emailDrafts.campaignId,
      personId: schema.emailDrafts.personId,
      sequenceId: schema.emailDrafts.sequenceId,
      sequenceStepId: schema.emailDrafts.sequenceStepId,
      aiReasoning: schema.emailDrafts.aiReasoning,
      reviewStatus: schema.emailDrafts.reviewStatus,
      status: schema.emailDrafts.status,
    })
    .from(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.id, body.draftId),
        eq(schema.emailDrafts.clerkUserId, userId),
      ),
    )
    .limit(1);

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.status} email` },
      { status: 409 },
    );
  }

  if (draft.reviewStatus !== "pending") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.reviewStatus} email` },
      { status: 409 },
    );
  }

  // Load person
  const [person] = await adminDb
    .select({
      id: schema.people.id,
      name: schema.people.name,
      title: schema.people.title,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
      organizationId: schema.people.organizationId,
      enrichmentData: schema.people.enrichmentData,
    })
    .from(schema.people)
    .where(eq(schema.people.id, draft.personId))
    .limit(1);

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  // Load campaign
  const [campaign] = await adminDb
    .select({
      name: schema.campaigns.name,
      icp: schema.campaigns.icp,
      offering: schema.campaigns.offering,
      positioning: schema.campaigns.positioning,
      profileId: schema.campaigns.profileId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, draft.campaignId))
    .limit(1);

  // Load sender profile if present
  let senderProfile: {
    name: string | null;
    roleTitle: string | null;
    companyName: string | null;
  } | null = null;

  if (campaign?.profileId) {
    const [profile] = await adminDb
      .select({
        name: schema.userProfile.name,
        roleTitle: schema.userProfile.roleTitle,
        companyName: schema.userProfile.companyName,
      })
      .from(schema.userProfile)
      .where(eq(schema.userProfile.id, campaign.profileId))
      .limit(1);
    senderProfile = profile ?? null;
  }

  // Load organization if the person has one
  let org: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    enrichmentData: Record<string, unknown>;
  } | null = null;

  if (person.organizationId) {
    const [orgRow] = await adminDb
      .select({
        name: schema.organizations.name,
        domain: schema.organizations.domain,
        industry: schema.organizations.industry,
        enrichmentData: schema.organizations.enrichmentData,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, person.organizationId))
      .limit(1);
    org = orgRow ?? null;
  }

  // Load step info
  let stepNumber = 1;
  let totalSteps = 1;
  let condition = "always";
  let isFinal = true;

  if (draft.sequenceStepId && draft.sequenceId) {
    const [stepRow] = await adminDb
      .select({
        stepNumber: schema.sequenceSteps.stepNumber,
        condition: schema.sequenceSteps.condition,
      })
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.id, draft.sequenceStepId))
      .limit(1);

    if (stepRow) {
      stepNumber = stepRow.stepNumber;
      condition = stepRow.condition ?? "always";
    }

    const [countRow] = await adminDb
      .select({ cnt: count() })
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, draft.sequenceId));

    totalSteps = Number(countRow?.cnt ?? 1);
    isFinal = stepNumber === totalSteps;
  }

  const skills = await loadActiveEmailSkills({
    userId,
    profileId: campaign?.profileId ?? null,
    campaignId: draft.campaignId,
  });

  const composed = await composeEmail({
    skills,
    contact: {
      name: person.name ?? null,
      title: person.title ?? null,
      email: person.workEmail ?? person.personalEmail ?? "unknown@example.com",
      enrichmentData: person.enrichmentData ?? null,
    },
    company: org
      ? {
          name: org.name,
          domain: org.domain,
          industry: org.industry,
          enrichmentData: org.enrichmentData,
        }
      : null,
    step: {
      stepNumber,
      totalSteps,
      condition,
      isFinal,
    },
    campaign: {
      name: campaign?.name ?? "Campaign",
      icp: campaign?.icp ?? null,
      offering: campaign?.offering ?? null,
      positioning: campaign?.positioning ?? null,
    },
    senderProfile: {
      name: senderProfile?.name ?? null,
      title: senderProfile?.roleTitle ?? null,
      company: senderProfile?.companyName ?? null,
      signature: null,
    },
    triggerReason: draft.aiReasoning ?? null,
  });

  if (!composed.ok) {
    return NextResponse.json(
      { error: composed.error || "Failed to regenerate email" },
      { status: 500 },
    );
  }

  const now = new Date();
  await adminDb
    .update(schema.emailDrafts)
    .set({
      subject: composed.email.subject,
      bodyHtml: composed.email.bodyHtml,
      bodyText: composed.email.bodyText ?? null,
      aiReasoning: composed.email.aiReasoning ?? draft.aiReasoning,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.emailDrafts.id, draft.id),
        eq(schema.emailDrafts.clerkUserId, userId),
      ),
    );

  return NextResponse.json({
    ok: true,
    draftId: draft.id,
    subject: composed.email.subject,
    bodyHtml: composed.email.bodyHtml,
    bodyText: composed.email.bodyText ?? null,
    aiReasoning: composed.email.aiReasoning ?? null,
  });
}
