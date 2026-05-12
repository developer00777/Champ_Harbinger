import { NextResponse } from "next/server";
import { eq, and, inArray, lte, count } from "drizzle-orm";

import { getPostHogClient } from "@/lib/posthog-server";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { sendApprovedDraft } from "@/lib/services/outreach-sender";
import {
  selectContactsForSignal,
  type Candidate,
} from "@/lib/services/contact-selector";
import { composeEmail } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { saveDraft } from "@/lib/email-composition/save";

export const maxDuration = 120;

/**
 * Outreach processor. Handles two jobs:
 *
 * 1. Signal-triggered sends: called by /api/tracking/run after a threshold
 *    crossing. Payload: { signalId, campaignId, organizationId }
 *
 * 2. Time-delayed follow-ups: called by cron/QStash. Payload: { type: "followups" }
 *    Checks sequence_enrollments where next_send_at <= now and conditions are met.
 */

interface SignalPayload {
  type: "signal";
  signalId: string;
  campaignId: string;
  organizationId?: string;
  reason?: string;
  confidence?: string;
}

interface FollowupPayload {
  type: "followups";
}

type Payload = SignalPayload | FollowupPayload;

export async function POST(request: Request) {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type === "signal") {
    return handleSignalTrigger(payload);
  }

  if (payload.type === "followups") {
    return handleFollowups();
  }

  return NextResponse.json({ error: "Unknown payload type" }, { status: 400 });
}

// ── Signal-triggered sends ─────────────────────────────────────────────────

async function handleSignalTrigger(payload: SignalPayload) {
  // Find active sequences triggered by this signal in this campaign
  const sequences = await adminDb
    .select({
      id: schema.sequences.id,
      clerkUserId: schema.sequences.clerkUserId,
    })
    .from(schema.sequences)
    .where(
      and(
        eq(schema.sequences.triggerSignalId, payload.signalId),
        eq(schema.sequences.campaignId, payload.campaignId),
        eq(schema.sequences.status, "active"),
      ),
    );

  if (sequences.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no matching sequences" });
  }

  const sequenceIds = sequences.map((s) => s.id);

  let drafted = 0;
  if (payload.organizationId) {
    drafted = await pickAndDraft(payload, sequences);
  }

  // Find enrollments for this signal's sequences
  let enrollments = await adminDb
    .select({
      id: schema.sequenceEnrollments.id,
      sequenceId: schema.sequenceEnrollments.sequenceId,
      personId: schema.sequenceEnrollments.personId,
      campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId,
      currentStep: schema.sequenceEnrollments.currentStep,
    })
    .from(schema.sequenceEnrollments)
    .where(
      and(
        inArray(schema.sequenceEnrollments.sequenceId, sequenceIds),
        inArray(schema.sequenceEnrollments.status, ["waiting", "queued"]),
        eq(schema.sequenceEnrollments.currentStep, 1),
      ),
    );

  if (payload.organizationId) {
    const people = await adminDb
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(eq(schema.people.organizationId, payload.organizationId));

    if (!people || people.length === 0) {
      return NextResponse.json({
        sent: 0,
        drafted,
        reason: "no contacts at this org -- run findContacts for this org",
      });
    }

    const orgPersonIds = people.map((p) => p.id);
    enrollments = enrollments.filter((e) => orgPersonIds.includes(e.personId));
  }

  if (enrollments.length === 0) {
    return NextResponse.json({ sent: 0, drafted, reason: "no enrollments" });
  }

  let sent = 0;
  for (const enrollment of enrollments) {
    const didSend = await sendStepEmail({
      id: enrollment.id,
      sequence_id: enrollment.sequenceId,
      person_id: enrollment.personId,
      campaign_people_id: enrollment.campaignPeopleId,
      current_step: enrollment.currentStep,
    });
    if (didSend) sent++;
  }

  return NextResponse.json({
    sent,
    drafted,
    total: enrollments.length,
  });
}

// ── Contact selection + auto-draft for org-scoped fires ────────────────────

async function pickAndDraft(
  payload: SignalPayload,
  sequences: Array<{ id: string; clerkUserId: string }>,
): Promise<number> {
  if (!payload.organizationId) return 0;

  // Load signal metadata
  const [signal] = await adminDb
    .select({ name: schema.signals.name, category: schema.signals.category })
    .from(schema.signals)
    .where(eq(schema.signals.id, payload.signalId))
    .limit(1);

  // Load candidates: people at the org
  const people = await adminDb
    .select({
      id: schema.people.id,
      name: schema.people.name,
      title: schema.people.title,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
      linkedinUrl: schema.people.linkedinUrl,
      enrichmentData: schema.people.enrichmentData,
    })
    .from(schema.people)
    .where(eq(schema.people.organizationId, payload.organizationId));

  if (people.length === 0) return 0;

  const personIds = people.map((p) => p.id);
  const cpRows = await adminDb
    .select({
      id: schema.campaignPeople.id,
      personId: schema.campaignPeople.personId,
      priorityScore: schema.campaignPeople.priorityScore,
      outreachStatus: schema.campaignPeople.outreachStatus,
    })
    .from(schema.campaignPeople)
    .where(
      and(
        eq(schema.campaignPeople.campaignId, payload.campaignId),
        inArray(schema.campaignPeople.personId, personIds),
      ),
    );

  const cpByPersonId = new Map(cpRows.map((cp) => [cp.personId, cp]));

  const SKIP_STATUSES = new Set(["replied", "bounced", "complained"]);
  const candidates: Candidate[] = [];
  for (const p of people) {
    const cp = cpByPersonId.get(p.id);
    if (!cp) continue;
    if (SKIP_STATUSES.has(cp.outreachStatus)) continue;
    const email = p.workEmail ?? p.personalEmail;
    if (!email) continue;
    candidates.push({
      personId: p.id,
      name: p.name ?? null,
      title: p.title ?? null,
      workEmail: email,
      linkedinUrl: p.linkedinUrl ?? null,
      priorityScore: cp.priorityScore != null ? Number(cp.priorityScore) : null,
      enrichmentSummary: summarizeEnrichment(p.enrichmentData),
    });
  }

  if (candidates.length === 0) return 0;

  const { picks } = await selectContactsForSignal({
    reason: payload.reason ?? "Signal fired",
    signalName: signal?.name ?? "Unknown signal",
    signalCategory: signal?.category ?? "custom",
    candidates,
    maxPicks: 1,
  });

  if (picks.length === 0) return 0;

  // Load campaign + sender profile
  const [campaign] = await adminDb
    .select({
      name: schema.campaigns.name,
      icp: schema.campaigns.icp,
      offering: schema.campaigns.offering,
      positioning: schema.campaigns.positioning,
      profileId: schema.campaigns.profileId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, payload.campaignId))
    .limit(1);

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

  const [org] = await adminDb
    .select({
      name: schema.organizations.name,
      domain: schema.organizations.domain,
      industry: schema.organizations.industry,
      enrichmentData: schema.organizations.enrichmentData,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, payload.organizationId))
    .limit(1);

  const ownerId = sequences[0]?.clerkUserId ?? null;
  const activeSkills = ownerId
    ? await loadActiveEmailSkills({
        userId: ownerId,
        profileId: campaign?.profileId ?? null,
        campaignId: payload.campaignId,
      })
    : [];

  let drafted = 0;

  for (const pick of picks) {
    const person = people.find((p) => p.id === pick.personId);
    const cp = cpByPersonId.get(pick.personId);
    if (!person || !cp) continue;

    for (const seq of sequences) {
      // Upsert enrollment (unique on sequence_id, campaign_people_id)
      const [existingEnrollment] = await adminDb
        .select({
          id: schema.sequenceEnrollments.id,
          status: schema.sequenceEnrollments.status,
        })
        .from(schema.sequenceEnrollments)
        .where(
          and(
            eq(schema.sequenceEnrollments.sequenceId, seq.id),
            eq(schema.sequenceEnrollments.campaignPeopleId, cp.id),
          ),
        )
        .limit(1);

      let enrollmentId: string;
      if (existingEnrollment) {
        if (
          existingEnrollment.status !== "waiting" &&
          existingEnrollment.status !== "queued"
        ) {
          continue;
        }
        enrollmentId = existingEnrollment.id;
      } else {
        const [newEnrollment] = await adminDb
          .insert(schema.sequenceEnrollments)
          .values({
            sequenceId: seq.id,
            campaignPeopleId: cp.id,
            personId: pick.personId,
            currentStep: 1,
            status: "waiting",
            waitingSince: new Date(),
          })
          .returning({ id: schema.sequenceEnrollments.id });

        if (!newEnrollment) {
          console.error(
            "[outreach] enrollment insert failed — no row returned",
          );
          continue;
        }
        enrollmentId = newEnrollment.id;
      }

      // Load step 1
      const [step1] = await adminDb
        .select({
          id: schema.sequenceSteps.id,
          stepNumber: schema.sequenceSteps.stepNumber,
          condition: schema.sequenceSteps.condition,
        })
        .from(schema.sequenceSteps)
        .where(
          and(
            eq(schema.sequenceSteps.sequenceId, seq.id),
            eq(schema.sequenceSteps.stepNumber, 1),
          ),
        )
        .limit(1);

      if (!step1) continue;

      const [totalStepsRow] = await adminDb
        .select({ cnt: count() })
        .from(schema.sequenceSteps)
        .where(eq(schema.sequenceSteps.sequenceId, seq.id));
      const totalSteps = Number(totalStepsRow?.cnt ?? 1);

      // Skip if a draft already exists for (enrollment, step)
      const [existingDraft] = await adminDb
        .select({ id: schema.emailDrafts.id })
        .from(schema.emailDrafts)
        .where(
          and(
            eq(schema.emailDrafts.enrollmentId, enrollmentId),
            eq(schema.emailDrafts.sequenceStepId, step1.id),
          ),
        )
        .limit(1);

      if (existingDraft) continue;

      // Compose
      const composed = await composeEmail({
        skills: activeSkills,
        contact: {
          name: person.name ?? null,
          title: person.title ?? null,
          email: person.workEmail ?? "unknown@example.com",
          enrichmentData: person.enrichmentData ?? null,
        },
        company: org
          ? {
              name: org.name ?? null,
              domain: org.domain ?? null,
              industry: org.industry ?? null,
              enrichmentData: org.enrichmentData,
            }
          : null,
        step: {
          stepNumber: 1,
          totalSteps,
          condition: step1.condition ?? "always",
          isFinal: totalSteps === 1,
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
        triggerReason: payload.reason ?? null,
      });

      if (!composed.ok) {
        console.error(
          "[outreach] compose failed",
          pick.personId,
          composed.error,
        );
        continue;
      }

      const saveResult = await saveDraft({
        userId: seq.clerkUserId,
        campaignId: payload.campaignId,
        personId: pick.personId,
        subject: composed.email.subject,
        bodyHtml: composed.email.bodyHtml,
        bodyText: composed.email.bodyText ?? null,
        sequenceId: seq.id,
        sequenceStepId: step1.id,
        enrollmentId,
        aiReasoning: payload.reason ?? composed.email.aiReasoning ?? null,
      });

      if (saveResult.ok) {
        drafted++;
        getPostHogClient().capture({
          distinctId: seq.clerkUserId,
          event: "outreach_drafted",
          properties: {
            campaign_id: payload.campaignId,
            signal_id: payload.signalId,
            sequence_id: seq.id,
            person_id: pick.personId,
            organization_id: payload.organizationId ?? null,
          },
        });
      } else {
        console.error("[outreach] saveDraft failed", saveResult.error);
      }
    }
  }

  return drafted;
}

function summarizeEnrichment(
  data: Record<string, unknown> | null,
): string | null {
  if (!data) return null;
  const headline = (data.headline as string) ?? (data.summary as string);
  if (typeof headline === "string" && headline.length > 0) {
    return headline.slice(0, 240);
  }
  return null;
}

// ── Time-delayed follow-ups ────────────────────────────────────────────────

async function handleFollowups() {
  const now = new Date();

  // Find enrollments where it's time to send the next step
  const enrollments = await adminDb
    .select({
      id: schema.sequenceEnrollments.id,
      sequenceId: schema.sequenceEnrollments.sequenceId,
      personId: schema.sequenceEnrollments.personId,
      campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId,
      currentStep: schema.sequenceEnrollments.currentStep,
    })
    .from(schema.sequenceEnrollments)
    .where(
      and(
        eq(schema.sequenceEnrollments.status, "active"),
        lte(schema.sequenceEnrollments.nextSendAt, now),
      ),
    )
    .limit(50);

  if (enrollments.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const enrollment of enrollments) {
    // Load the step to check its condition
    const [step] = await adminDb
      .select({
        id: schema.sequenceSteps.id,
        condition: schema.sequenceSteps.condition,
      })
      .from(schema.sequenceSteps)
      .where(
        and(
          eq(schema.sequenceSteps.sequenceId, enrollment.sequenceId),
          eq(schema.sequenceSteps.stepNumber, enrollment.currentStep),
        ),
      )
      .limit(1);

    if (!step) {
      // No more steps — mark completed
      await adminDb
        .update(schema.sequenceEnrollments)
        .set({ status: "completed", updatedAt: now })
        .where(eq(schema.sequenceEnrollments.id, enrollment.id));
      continue;
    }

    // Check condition against outreach status
    const [cp] = await adminDb
      .select({ outreachStatus: schema.campaignPeople.outreachStatus })
      .from(schema.campaignPeople)
      .where(eq(schema.campaignPeople.id, enrollment.campaignPeopleId))
      .limit(1);

    const outreachStatus = cp?.outreachStatus ?? "sent";

    if (outreachStatus === "replied") {
      await adminDb
        .update(schema.sequenceEnrollments)
        .set({ status: "replied", updatedAt: now })
        .where(eq(schema.sequenceEnrollments.id, enrollment.id));
      skipped++;
      continue;
    }

    if (outreachStatus === "bounced" || outreachStatus === "complained") {
      await adminDb
        .update(schema.sequenceEnrollments)
        .set({ status: "bounced", updatedAt: now })
        .where(eq(schema.sequenceEnrollments.id, enrollment.id));
      skipped++;
      continue;
    }

    const shouldSend = checkCondition(
      step.condition ?? "always",
      outreachStatus,
    );
    if (!shouldSend) {
      skipped++;
      continue;
    }

    const didSend = await sendStepEmail({
      id: enrollment.id,
      sequence_id: enrollment.sequenceId,
      person_id: enrollment.personId,
      campaign_people_id: enrollment.campaignPeopleId,
      current_step: enrollment.currentStep,
    });
    if (didSend) sent++;
  }

  return NextResponse.json({ sent, skipped, total: enrollments.length });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function checkCondition(condition: string, outreachStatus: string): boolean {
  switch (condition) {
    case "always":
      return true;
    case "no_reply":
      return outreachStatus !== "replied";
    case "no_open":
      return !["opened", "clicked", "replied"].includes(outreachStatus);
    case "opened_no_reply":
      return ["opened", "clicked"].includes(outreachStatus);
    default:
      return true;
  }
}

async function sendStepEmail(enrollment: {
  id: string;
  sequence_id: string;
  person_id: string;
  campaign_people_id: string;
  current_step: number;
}): Promise<boolean> {
  const result = await sendApprovedDraft(enrollment);
  return result.ok;
}
