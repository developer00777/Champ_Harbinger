import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, and, inArray, desc, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/outreach
 * Returns sequences, enrollments, drafts and step counts for the outreach page.
 */
export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 1. Sequences for this user ────────────────────────────────────────────
  const seqRows = await adminDb
    .select({
      id: schema.sequences.id,
      name: schema.sequences.name,
      status: schema.sequences.status,
      campaignId: schema.sequences.campaignId,
    })
    .from(schema.sequences)
    .where(eq(schema.sequences.clerkUserId, userId))
    .orderBy(desc(schema.sequences.createdAt));

  if (seqRows.length === 0) {
    return NextResponse.json({
      sequences: [],
      enrollments: [],
      drafts: [],
    });
  }

  const sequenceIds = seqRows.map((s) => s.id);
  const campaignIds = [...new Set(seqRows.map((s) => s.campaignId))];

  // ── 2. Campaign names ─────────────────────────────────────────────────────
  const campaignRows = await adminDb
    .select({ id: schema.campaigns.id, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.id, campaignIds));

  const campaignNameById = new Map(campaignRows.map((c) => [c.id, c.name]));

  // ── 3. Enrollment counts ──────────────────────────────────────────────────
  const enrollmentCounts = await adminDb
    .select({
      sequenceId: schema.sequenceEnrollments.sequenceId,
      status: schema.sequenceEnrollments.status,
      cnt: count(),
    })
    .from(schema.sequenceEnrollments)
    .where(inArray(schema.sequenceEnrollments.sequenceId, sequenceIds))
    .groupBy(
      schema.sequenceEnrollments.sequenceId,
      schema.sequenceEnrollments.status,
    );

  const countsBySeq = new Map<
    string,
    { enrolled: number; waiting: number; sent: number; replied: number }
  >();
  for (const row of enrollmentCounts) {
    const prev = countsBySeq.get(row.sequenceId) ?? {
      enrolled: 0,
      waiting: 0,
      sent: 0,
      replied: 0,
    };
    prev.enrolled += Number(row.cnt);
    if (row.status === "waiting" || row.status === "queued")
      prev.waiting += Number(row.cnt);
    if (row.status === "active") prev.sent += Number(row.cnt);
    if (row.status === "replied") prev.replied += Number(row.cnt);
    countsBySeq.set(row.sequenceId, prev);
  }

  const sequences = seqRows.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    campaign_id: s.campaignId,
    campaign_name: campaignNameById.get(s.campaignId) ?? "Unknown",
    ...(countsBySeq.get(s.id) ?? {
      enrolled: 0,
      waiting: 0,
      sent: 0,
      replied: 0,
    }),
  }));

  // ── 4. Active enrollments (for the enrollments tab) ───────────────────────
  const activeEnrollments = await adminDb
    .select({
      id: schema.sequenceEnrollments.id,
      sequenceId: schema.sequenceEnrollments.sequenceId,
      personId: schema.sequenceEnrollments.personId,
      campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId,
      currentStep: schema.sequenceEnrollments.currentStep,
      status: schema.sequenceEnrollments.status,
      nextSendAt: schema.sequenceEnrollments.nextSendAt,
    })
    .from(schema.sequenceEnrollments)
    .where(
      and(
        inArray(schema.sequenceEnrollments.sequenceId, sequenceIds),
        inArray(schema.sequenceEnrollments.status, [
          "waiting",
          "queued",
          "active",
          "replied",
        ]),
      ),
    )
    .orderBy(desc(schema.sequenceEnrollments.updatedAt));

  // Fetch people + organizations for those enrollments
  const enrollmentPersonIds = [
    ...new Set(activeEnrollments.map((e) => e.personId)),
  ];
  const enrollmentCpIds = [
    ...new Set(activeEnrollments.map((e) => e.campaignPeopleId)),
  ];

  const [personRows, cpRows, seqNameRows] = await Promise.all([
    enrollmentPersonIds.length > 0
      ? adminDb
          .select({
            id: schema.people.id,
            name: schema.people.name,
            title: schema.people.title,
            organizationId: schema.people.organizationId,
          })
          .from(schema.people)
          .where(inArray(schema.people.id, enrollmentPersonIds))
      : Promise.resolve([]),
    enrollmentCpIds.length > 0
      ? adminDb
          .select({
            id: schema.campaignPeople.id,
            outreachStatus: schema.campaignPeople.outreachStatus,
          })
          .from(schema.campaignPeople)
          .where(inArray(schema.campaignPeople.id, enrollmentCpIds))
      : Promise.resolve([]),
    adminDb
      .select({ id: schema.sequences.id, name: schema.sequences.name })
      .from(schema.sequences)
      .where(inArray(schema.sequences.id, sequenceIds)),
  ]);

  const orgIds = [
    ...new Set(
      personRows
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
          })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, orgIds))
      : [];

  const personById = new Map(personRows.map((p) => [p.id, p]));
  const orgById = new Map(orgRows.map((o) => [o.id, o]));
  const cpById = new Map(cpRows.map((cp) => [cp.id, cp]));
  const seqById = new Map(seqNameRows.map((s) => [s.id, s]));

  const enrollments = activeEnrollments.map((e) => {
    const person = personById.get(e.personId);
    const cp = cpById.get(e.campaignPeopleId);
    const org = person?.organizationId
      ? orgById.get(person.organizationId)
      : null;
    const seq = seqById.get(e.sequenceId);
    return {
      id: e.id,
      sequence_id: e.sequenceId,
      person_id: e.personId,
      campaign_people_id: e.campaignPeopleId,
      current_step: e.currentStep,
      status: e.status,
      next_send_at: e.nextSendAt?.toISOString() ?? null,
      person_name: person?.name ?? "Unknown",
      person_title: person?.title ?? null,
      company_name: org?.name ?? null,
      outreach_status: cp?.outreachStatus ?? null,
      sequence_name: seq?.name ?? "",
    };
  });

  // ── 5. Draft emails ───────────────────────────────────────────────────────
  const draftRows = await adminDb
    .select({
      id: schema.emailDrafts.id,
      subject: schema.emailDrafts.subject,
      toEmail: schema.emailDrafts.toEmail,
      reviewStatus: schema.emailDrafts.reviewStatus,
      status: schema.emailDrafts.status,
      personId: schema.emailDrafts.personId,
      enrollmentId: schema.emailDrafts.enrollmentId,
      sequenceId: schema.emailDrafts.sequenceId,
      sequenceStepId: schema.emailDrafts.sequenceStepId,
      createdAt: schema.emailDrafts.createdAt,
    })
    .from(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.clerkUserId, userId),
        eq(schema.emailDrafts.status, "draft"),
        inArray(schema.emailDrafts.sequenceId, sequenceIds),
      ),
    )
    .orderBy(desc(schema.emailDrafts.createdAt))
    .limit(200);

  // Get step numbers for the drafts
  const draftStepIds = [
    ...new Set(
      draftRows
        .map((d) => d.sequenceStepId)
        .filter((id): id is string => id != null),
    ),
  ];
  const stepNumberRows =
    draftStepIds.length > 0
      ? await adminDb
          .select({
            id: schema.sequenceSteps.id,
            sequenceId: schema.sequenceSteps.sequenceId,
            stepNumber: schema.sequenceSteps.stepNumber,
          })
          .from(schema.sequenceSteps)
          .where(inArray(schema.sequenceSteps.id, draftStepIds))
      : [];

  // Count total steps per sequence for N/M display
  const totalStepCounts =
    sequenceIds.length > 0
      ? await adminDb
          .select({
            sequenceId: schema.sequenceSteps.sequenceId,
            cnt: count(),
          })
          .from(schema.sequenceSteps)
          .where(inArray(schema.sequenceSteps.sequenceId, sequenceIds))
          .groupBy(schema.sequenceSteps.sequenceId)
      : [];

  const stepById = new Map(stepNumberRows.map((s) => [s.id, s]));
  const totalStepsBySeq = new Map(
    totalStepCounts.map((r) => [r.sequenceId, Number(r.cnt)]),
  );

  // Get enrollment next_send_at for the draft rows that have an enrollmentId
  const draftEnrollmentIds = [
    ...new Set(
      draftRows
        .map((d) => d.enrollmentId)
        .filter((id): id is string => id != null),
    ),
  ];
  const enrollmentNextSendRows =
    draftEnrollmentIds.length > 0
      ? await adminDb
          .select({
            id: schema.sequenceEnrollments.id,
            nextSendAt: schema.sequenceEnrollments.nextSendAt,
          })
          .from(schema.sequenceEnrollments)
          .where(inArray(schema.sequenceEnrollments.id, draftEnrollmentIds))
      : [];
  const enrollmentNextSendById = new Map(
    enrollmentNextSendRows.map((e) => [e.id, e.nextSendAt]),
  );

  // Build people/org lookup for drafts (reuse personById/orgById from above,
  // but also fetch any people not in the enrollments result)
  const draftPersonIds = [
    ...new Set(
      draftRows.map((d) => d.personId).filter((id) => !personById.has(id)),
    ),
  ];
  if (draftPersonIds.length > 0) {
    const extraPeople = await adminDb
      .select({
        id: schema.people.id,
        name: schema.people.name,
        title: schema.people.title,
        organizationId: schema.people.organizationId,
      })
      .from(schema.people)
      .where(inArray(schema.people.id, draftPersonIds));
    for (const p of extraPeople) personById.set(p.id, p);

    const extraOrgIds = [
      ...new Set(
        extraPeople
          .map((p) => p.organizationId)
          .filter((id): id is string => id != null && !orgById.has(id)),
      ),
    ];
    if (extraOrgIds.length > 0) {
      const extraOrgs = await adminDb
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
        })
        .from(schema.organizations)
        .where(inArray(schema.organizations.id, extraOrgIds));
      for (const o of extraOrgs) orgById.set(o.id, o);
    }
  }

  const drafts = draftRows.map((d) => {
    const person = personById.get(d.personId);
    const org = person?.organizationId
      ? orgById.get(person.organizationId)
      : null;
    const step = d.sequenceStepId ? stepById.get(d.sequenceStepId) : null;
    const seqId = d.sequenceId ?? null;
    const seq = seqId ? seqById.get(seqId) : null;
    const nextSendAt = d.enrollmentId
      ? (enrollmentNextSendById.get(d.enrollmentId)?.toISOString() ?? null)
      : null;

    return {
      id: d.id,
      subject: d.subject,
      to_email: d.toEmail,
      review_status: d.reviewStatus,
      status: d.status,
      person_name: person?.name ?? "Unknown",
      person_title: person?.title ?? null,
      company_name: org?.name ?? null,
      sequence_id: seqId,
      sequence_name: seq?.name ?? null,
      next_send_at: nextSendAt,
      step_number: step?.stepNumber ?? 1,
      total_steps: seqId ? (totalStepsBySeq.get(seqId) ?? 1) : 1,
      enrollment_id: d.enrollmentId ?? null,
      has_inbox: false,
    };
  });

  return NextResponse.json({ sequences, enrollments, drafts });
}
