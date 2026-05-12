import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, and, inArray, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/outreach/drafts?sequence=<sequenceId>
 * Returns pending drafts for a sequence, grouped by person, with all
 * enrichment and step metadata needed by the review page.
 */
export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sequenceId = searchParams.get("sequence");

  if (!sequenceId) {
    return NextResponse.json(
      { error: "sequence param is required" },
      { status: 400 },
    );
  }

  // Verify the sequence belongs to this user
  const [seq] = await adminDb
    .select({ id: schema.sequences.id })
    .from(schema.sequences)
    .where(
      and(
        eq(schema.sequences.id, sequenceId),
        eq(schema.sequences.clerkUserId, userId),
      ),
    )
    .limit(1);

  if (!seq) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  // Load all pending drafts for this sequence
  const draftRows = await adminDb
    .select({
      id: schema.emailDrafts.id,
      toEmail: schema.emailDrafts.toEmail,
      subject: schema.emailDrafts.subject,
      bodyHtml: schema.emailDrafts.bodyHtml,
      bodyText: schema.emailDrafts.bodyText,
      aiReasoning: schema.emailDrafts.aiReasoning,
      reviewStatus: schema.emailDrafts.reviewStatus,
      status: schema.emailDrafts.status,
      sequenceStepId: schema.emailDrafts.sequenceStepId,
      enrollmentId: schema.emailDrafts.enrollmentId,
      personId: schema.emailDrafts.personId,
      campaignPeopleId: schema.emailDrafts.campaignPeopleId,
    })
    .from(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.sequenceId, sequenceId),
        eq(schema.emailDrafts.reviewStatus, "pending"),
        eq(schema.emailDrafts.clerkUserId, userId),
      ),
    )
    .orderBy(schema.emailDrafts.personId, schema.emailDrafts.sequenceStepId);

  // Count total steps for N/M display
  const [totalStepsRow] = await adminDb
    .select({ cnt: count() })
    .from(schema.sequenceSteps)
    .where(eq(schema.sequenceSteps.sequenceId, sequenceId));
  const totalSteps = Number(totalStepsRow?.cnt ?? 1);

  if (draftRows.length === 0) {
    return NextResponse.json({ drafts: [], totalSteps });
  }

  const personIds = [...new Set(draftRows.map((d) => d.personId))];
  const cpIds = [...new Set(draftRows.map((d) => d.campaignPeopleId))];
  const stepIds = [
    ...new Set(
      draftRows
        .map((d) => d.sequenceStepId)
        .filter((id): id is string => id != null),
    ),
  ];
  const enrollmentIds = [
    ...new Set(
      draftRows
        .map((d) => d.enrollmentId)
        .filter((id): id is string => id != null),
    ),
  ];

  const [peopleRows, cpRows, stepRows, enrollmentRows] = await Promise.all([
    adminDb
      .select({
        id: schema.people.id,
        name: schema.people.name,
        title: schema.people.title,
        organizationId: schema.people.organizationId,
        workEmail: schema.people.workEmail,
        workEmailConfidence: schema.people.workEmailConfidence,
        personalEmail: schema.people.personalEmail,
        linkedinUrl: schema.people.linkedinUrl,
        twitterUrl: schema.people.twitterUrl,
        enrichmentData: schema.people.enrichmentData,
        enrichmentStatus: schema.people.enrichmentStatus,
        lastEnrichedAt: schema.people.lastEnrichedAt,
      })
      .from(schema.people)
      .where(inArray(schema.people.id, personIds)),
    adminDb
      .select({
        id: schema.campaignPeople.id,
        priorityScore: schema.campaignPeople.priorityScore,
      })
      .from(schema.campaignPeople)
      .where(inArray(schema.campaignPeople.id, cpIds)),
    stepIds.length > 0
      ? adminDb
          .select({
            id: schema.sequenceSteps.id,
            stepNumber: schema.sequenceSteps.stepNumber,
            delayDays: schema.sequenceSteps.delayDays,
            delayHours: schema.sequenceSteps.delayHours,
          })
          .from(schema.sequenceSteps)
          .where(inArray(schema.sequenceSteps.id, stepIds))
      : Promise.resolve([]),
    enrollmentIds.length > 0
      ? adminDb
          .select({
            id: schema.sequenceEnrollments.id,
            currentStep: schema.sequenceEnrollments.currentStep,
          })
          .from(schema.sequenceEnrollments)
          .where(inArray(schema.sequenceEnrollments.id, enrollmentIds))
      : Promise.resolve([]),
  ]);

  // Load organization names for people
  const orgIds = [
    ...new Set(
      peopleRows
        .map((p) => p.organizationId)
        .filter((id): id is string => id != null),
    ),
  ];
  const orgRows =
    orgIds.length > 0
      ? await adminDb
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
            domain: schema.organizations.domain,
            industry: schema.organizations.industry,
          })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, orgIds))
      : [];

  const personById = new Map(peopleRows.map((p) => [p.id, p]));
  const orgById = new Map(orgRows.map((o) => [o.id, o]));
  const cpById = new Map(cpRows.map((cp) => [cp.id, cp]));
  const stepById = new Map(stepRows.map((s) => [s.id, s]));
  const enrollmentById = new Map(enrollmentRows.map((e) => [e.id, e]));

  const drafts = draftRows.map((d) => {
    const person = personById.get(d.personId);
    const org = person?.organizationId
      ? orgById.get(person.organizationId)
      : null;
    const cp = cpById.get(d.campaignPeopleId);
    const step = d.sequenceStepId ? stepById.get(d.sequenceStepId) : null;
    const enrollment = d.enrollmentId
      ? enrollmentById.get(d.enrollmentId)
      : null;

    return {
      id: d.id,
      to_email: d.toEmail,
      subject: d.subject,
      body_html: d.bodyHtml,
      body_text: d.bodyText ?? null,
      ai_reasoning: d.aiReasoning ?? null,
      review_status: d.reviewStatus ?? "pending",
      status: d.status,
      sequence_step_id: d.sequenceStepId ?? null,
      enrollment_id: d.enrollmentId ?? null,
      enrollment_current_step: enrollment?.currentStep ?? null,
      person_id: d.personId,
      person_name: person?.name ?? "Unknown",
      person_title: person?.title ?? null,
      person_work_email: person?.workEmail ?? null,
      person_work_email_confidence: person?.workEmailConfidence ?? null,
      person_personal_email: person?.personalEmail ?? null,
      person_linkedin_url: person?.linkedinUrl ?? null,
      person_twitter_url: person?.twitterUrl ?? null,
      company_name: org?.name ?? null,
      company_domain: org?.domain ?? null,
      company_industry: org?.industry ?? null,
      priority_score:
        cp?.priorityScore != null ? Number(cp.priorityScore) : null,
      enrichment_status: (person?.enrichmentStatus ?? "pending") as
        | "pending"
        | "in_progress"
        | "enriched"
        | "failed",
      last_enriched_at: person?.lastEnrichedAt?.toISOString() ?? null,
      enrichment_data: (person?.enrichmentData ?? {}) as Record<
        string,
        unknown
      >,
      step_number: step?.stepNumber ?? 1,
      total_steps: totalSteps,
      delay_days: step?.delayDays ?? null,
      delay_hours: step?.delayHours ?? null,
    };
  });

  return NextResponse.json({ drafts, totalSteps });
}

/**
 * PATCH /api/outreach/drafts
 * Bulk-updates draft fields (subject, body, review_status) and/or person email.
 *
 * Body: {
 *   updates?: Array<{
 *     id: string;
 *     subject?: string;
 *     bodyHtml?: string;
 *     bodyText?: string;
 *     reviewStatus?: string;
 *     toEmail?: string;
 *   }>;
 *   personEmailUpdate?: { personId: string; email: string; draftIds: string[] };
 * }
 */
export async function PATCH(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    updates?: Array<{
      id: string;
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      reviewStatus?: string;
      toEmail?: string;
    }>;
    personEmailUpdate?: { personId: string; email: string; draftIds: string[] };
  };

  const now = new Date();

  if (body.updates && body.updates.length > 0) {
    await Promise.all(
      body.updates.map(async (u) => {
        const patch: Record<string, unknown> = { updatedAt: now };
        if (u.subject !== undefined) patch.subject = u.subject;
        if (u.bodyHtml !== undefined) patch.bodyHtml = u.bodyHtml;
        if (u.bodyText !== undefined) patch.bodyText = u.bodyText;
        if (u.reviewStatus !== undefined) patch.reviewStatus = u.reviewStatus;
        if (u.toEmail !== undefined) patch.toEmail = u.toEmail;

        await adminDb
          .update(schema.emailDrafts)
          .set(patch)
          .where(
            and(
              eq(schema.emailDrafts.id, u.id),
              eq(schema.emailDrafts.clerkUserId, userId),
            ),
          );
      }),
    );
  }

  if (body.personEmailUpdate) {
    const { personId, email, draftIds } = body.personEmailUpdate;

    // Update person's work email
    await adminDb
      .update(schema.people)
      .set({ workEmail: email, updatedAt: now })
      .where(eq(schema.people.id, personId));

    // Update toEmail on the specified drafts (scoped to this user)
    if (draftIds.length > 0) {
      await adminDb
        .update(schema.emailDrafts)
        .set({ toEmail: email, updatedAt: now })
        .where(
          and(
            inArray(schema.emailDrafts.id, draftIds),
            eq(schema.emailDrafts.clerkUserId, userId),
          ),
        );
    }
  }

  return NextResponse.json({ ok: true });
}
