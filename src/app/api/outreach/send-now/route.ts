import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { sendApprovedDraft } from "@/lib/services/outreach-sender";
import { getPostHogClient } from "@/lib/posthog-server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

export const maxDuration = 60;

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
      reviewStatus: schema.emailDrafts.reviewStatus,
      status: schema.emailDrafts.status,
      enrollmentId: schema.emailDrafts.enrollmentId,
      sequenceStepId: schema.emailDrafts.sequenceStepId,
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

  if (draft.reviewStatus !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        blocker: "not_approved",
        error: "Draft must be approved before it can be sent",
      },
      { status: 409 },
    );
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      {
        ok: false,
        blocker: "already_sent",
        error: `Draft is already ${draft.status}`,
      },
      { status: 409 },
    );
  }

  if (!draft.enrollmentId) {
    return NextResponse.json(
      {
        ok: false,
        blocker: "no_enrollment",
        error: "Draft has no enrollment",
      },
      { status: 409 },
    );
  }

  // Load enrollment
  const [enrollment] = await adminDb
    .select({
      id: schema.sequenceEnrollments.id,
      sequenceId: schema.sequenceEnrollments.sequenceId,
      personId: schema.sequenceEnrollments.personId,
      campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId,
      currentStep: schema.sequenceEnrollments.currentStep,
    })
    .from(schema.sequenceEnrollments)
    .where(eq(schema.sequenceEnrollments.id, draft.enrollmentId))
    .limit(1);

  if (!enrollment) {
    return NextResponse.json(
      { ok: false, blocker: "no_enrollment", error: "Enrollment not found" },
      { status: 404 },
    );
  }

  const result = await sendApprovedDraft({
    id: enrollment.id,
    sequence_id: enrollment.sequenceId,
    person_id: enrollment.personId,
    campaign_people_id: enrollment.campaignPeopleId,
    current_step: enrollment.currentStep,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 500 },
    );
  }

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: userId,
    event: "outreach_email_sent",
    properties: {
      draft_id: result.draftId,
      sequence_id: enrollment.sequenceId,
      person_id: enrollment.personId,
      step: enrollment.currentStep,
    },
  });

  return NextResponse.json({
    ok: true,
    draftId: result.draftId,
    messageId: result.messageId,
    sentAt: new Date().toISOString(),
  });
}
