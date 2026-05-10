import { eq, and } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { sendMessage } from "@/lib/services/agentmail-service";
import { trackUsage } from "@/lib/services/cost-tracker";

export interface EnrollmentForSend {
  id: string;
  sequence_id: string;
  person_id: string;
  campaign_people_id: string;
  current_step: number;
}

export type SendResult =
  | { ok: true; messageId: string; draftId: string }
  | { ok: false; reason: string };

/**
 * Sends the next pending approved draft for an enrollment.
 *
 * Expects the enrollment's step to have a draft with
 * `review_status = "approved"` and `status = "draft"`.
 *
 * On success: marks draft sent, records sent_emails row, updates
 * campaign_people.outreach_status, advances the enrollment to the next
 * step (or marks it completed). Ignores enrollment.next_send_at — callers
 * that need to respect delays must check before calling.
 */
export async function sendApprovedDraft(
  enrollment: EnrollmentForSend,
): Promise<SendResult> {
  const now = new Date();

  const [step] = await adminDb
    .select({ id: schema.sequenceSteps.id })
    .from(schema.sequenceSteps)
    .where(
      and(
        eq(schema.sequenceSteps.sequenceId, enrollment.sequence_id),
        eq(schema.sequenceSteps.stepNumber, enrollment.current_step),
      ),
    )
    .limit(1);

  if (!step) return { ok: false, reason: "Step not found" };

  const [draft] = await adminDb
    .select()
    .from(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.enrollmentId, enrollment.id),
        eq(schema.emailDrafts.sequenceStepId, step.id),
        eq(schema.emailDrafts.reviewStatus, "approved"),
        eq(schema.emailDrafts.status, "draft"),
      ),
    )
    .limit(1);

  if (!draft) {
    return { ok: false, reason: "No approved draft ready for this step" };
  }

  const [settings] = await adminDb
    .select({ agentmailInboxId: schema.userSettings.agentmailInboxId })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, draft.clerkUserId))
    .limit(1);

  if (!settings?.agentmailInboxId) {
    return { ok: false, reason: "No AgentMail inbox configured" };
  }

  try {
    const result = await sendMessage(settings.agentmailInboxId, {
      to: draft.toEmail,
      subject: draft.subject,
      html: draft.bodyHtml,
      text: draft.bodyText ?? undefined,
    });

    const messageId = result.messageId ?? crypto.randomUUID();
    const threadId = result.threadId ?? null;

    await adminDb.insert(schema.sentEmails).values({
      agentmailMessageId: messageId,
      agentmailThreadId: threadId,
      draftId: draft.id,
      campaignPeopleId: enrollment.campaign_people_id,
      campaignId: draft.campaignId,
      personId: enrollment.person_id,
      clerkUserId: draft.clerkUserId,
      clerkOrgId: draft.clerkOrgId,
      toEmail: draft.toEmail,
      fromEmail: settings.agentmailInboxId,
      subject: draft.subject,
      status: "sent",
      sentAt: now,
    });

    await adminDb
      .update(schema.emailDrafts)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(schema.emailDrafts.id, draft.id));

    await adminDb
      .update(schema.campaignPeople)
      .set({ outreachStatus: "sent" })
      .where(eq(schema.campaignPeople.id, enrollment.campaign_people_id));

    const nextStep = enrollment.current_step + 1;
    const [nextStepRow] = await adminDb
      .select({
        delayDays: schema.sequenceSteps.delayDays,
        delayHours: schema.sequenceSteps.delayHours,
      })
      .from(schema.sequenceSteps)
      .where(
        and(
          eq(schema.sequenceSteps.sequenceId, enrollment.sequence_id),
          eq(schema.sequenceSteps.stepNumber, nextStep),
        ),
      )
      .limit(1);

    if (nextStepRow) {
      const delayMs =
        ((nextStepRow.delayDays ?? 0) * 86400 +
          (nextStepRow.delayHours ?? 0) * 3600) *
        1000;
      const nextSendAt = new Date(Date.now() + delayMs);

      await adminDb
        .update(schema.sequenceEnrollments)
        .set({
          currentStep: nextStep,
          status: "active",
          nextSendAt,
          updatedAt: now,
        })
        .where(eq(schema.sequenceEnrollments.id, enrollment.id));
    } else {
      await adminDb
        .update(schema.sequenceEnrollments)
        .set({ status: "completed", updatedAt: now })
        .where(eq(schema.sequenceEnrollments.id, enrollment.id));
    }

    trackUsage({
      service: "agentmail",
      operation: "send-email",
      estimated_cost_usd: 0.0004,
      campaign_id: draft.campaignId,
      user_id: draft.clerkUserId,
      metadata: {
        draftId: draft.id,
        to: draft.toEmail,
        sequenceId: enrollment.sequence_id,
      },
    });

    return { ok: true, messageId, draftId: draft.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Send failed";
    return { ok: false, reason };
  }
}
