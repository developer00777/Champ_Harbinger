import "server-only";

import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { classifyReply, type ReplyIntent } from "./classify";
import {
  composeEmail,
  type ComposeInput,
} from "@/lib/email-composition/compose";
import { getEmailProvider } from "@/lib/email/provider";
import {
  getConnectorForRow,
  getDefaultMailboxRow,
} from "@/lib/mailbox/registry";

/**
 * Status stamped on `sequenceEnrollments.status` the instant a reply is
 * detected — before classification, before any drafting. This is the whole
 * point of Port D: no contact should ever get simultaneously emailed by a
 * human-approved reply/handoff AND a stale automated sequence step.
 *
 * "halted" is a new value in this codebase's enrollment status vocabulary
 * (existing values seen elsewhere: waiting, queued, active, completed — see
 * src/app/api/outreach/process/route.ts, src/lib/tools/sequence-tools.ts).
 * out_of_office reschedules back to "waiting"; every other intent keeps the
 * enrollment halted permanently (a human decides what happens next).
 */
export const HALT_STATUS = "halted";

/** How far out an out-of-office reply pushes the next automated send. */
const OOO_RESCHEDULE_DAYS = 3;

export interface HandleInboundResult {
  ok: boolean;
  mailboxMessageId: string;
  error?: string;
  intent?: ReplyIntent;
  confidence?: number;
  classificationFailed?: boolean;
  haltedEnrollmentIds?: string[];
  action?:
    | "halted_only"
    | "rescheduled"
    | "warm_intro_sent"
    | "warm_intro_failed"
    | "drafted_reply"
    | "draft_failed"
    | "no_sequence_context";
  draftId?: string;
}

interface ReplyContext {
  sentEmailId: string;
  campaignId: string;
  campaignPeopleId: string;
  personId: string;
  clerkUserId: string;
  clerkOrgId: string | null;
  originalSubject: string;
}

/**
 * The halt-on-reply step. Unconditional and first: called before any
 * classification or drafting logic runs. Stamps `sentEmails.repliedAt` and
 * flips every `sequenceEnrollments` row for the contact to `HALT_STATUS`,
 * regardless of what happens afterward (including a classification throw).
 *
 * Returns the reply context (if the inbound message links to a sent email)
 * and the list of enrollment ids that were halted.
 */
async function haltOnReply(
  message: typeof schema.mailboxMessages.$inferSelect,
): Promise<{ context: ReplyContext | null; haltedEnrollmentIds: string[] }> {
  if (!message.sentEmailId) {
    return { context: null, haltedEnrollmentIds: [] };
  }

  const now = new Date();

  const [sentEmail] = await adminDb
    .select({
      id: schema.sentEmails.id,
      campaignId: schema.sentEmails.campaignId,
      campaignPeopleId: schema.sentEmails.campaignPeopleId,
      personId: schema.sentEmails.personId,
      clerkUserId: schema.sentEmails.clerkUserId,
      clerkOrgId: schema.sentEmails.clerkOrgId,
      subject: schema.sentEmails.subject,
      repliedAt: schema.sentEmails.repliedAt,
    })
    .from(schema.sentEmails)
    .where(eq(schema.sentEmails.id, message.sentEmailId))
    .limit(1);

  if (!sentEmail) {
    return { context: null, haltedEnrollmentIds: [] };
  }

  // Stamp the reply on the sent email (idempotent — always set to "now" on
  // the latest detected reply; harmless if already set).
  await adminDb
    .update(schema.sentEmails)
    .set({ repliedAt: sentEmail.repliedAt ?? now })
    .where(eq(schema.sentEmails.id, sentEmail.id));

  // Halt EVERY enrollment for this contact (campaignPeopleId), not just the
  // one tied to this specific sent email — a reply means "stop automating
  // this human," full stop, regardless of which sequence/step sent the
  // message being replied to.
  const haltedRows = await adminDb
    .update(schema.sequenceEnrollments)
    .set({ status: HALT_STATUS, updatedAt: now })
    .where(
      eq(
        schema.sequenceEnrollments.campaignPeopleId,
        sentEmail.campaignPeopleId,
      ),
    )
    .returning({ id: schema.sequenceEnrollments.id });

  return {
    context: {
      sentEmailId: sentEmail.id,
      campaignId: sentEmail.campaignId,
      campaignPeopleId: sentEmail.campaignPeopleId,
      personId: sentEmail.personId,
      clerkUserId: sentEmail.clerkUserId,
      clerkOrgId: sentEmail.clerkOrgId ?? null,
      originalSubject: sentEmail.subject,
    },
    haltedEnrollmentIds: haltedRows.map((r) => r.id),
  };
}

/**
 * Best-effort person context lookup. `knowledge-graph` is a sibling module
 * that may not exist yet (or may fail independently) — dynamically imported
 * and fully guarded so its absence/failure never blocks reply handling.
 */
async function tryGetPersonContext(
  personId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const mod = (await import("@/lib/knowledge-graph/retrieval").catch(
      () => null,
    )) as { getPersonContext?: (id: string) => Promise<unknown> } | null;
    if (!mod?.getPersonContext) return null;
    const context = await mod.getPersonContext(personId);
    return (context ?? null) as Record<string, unknown> | null;
  } catch (err) {
    console.warn("[aisdr/respond] getPersonContext failed, continuing:", err);
    return null;
  }
}

async function rescheduleForOutOfOffice(
  enrollmentIds: string[],
): Promise<void> {
  if (enrollmentIds.length === 0) return;
  const nextSendAt = new Date(
    Date.now() + OOO_RESCHEDULE_DAYS * 24 * 60 * 60 * 1000,
  );
  await Promise.all(
    enrollmentIds.map((id) =>
      adminDb
        .update(schema.sequenceEnrollments)
        .set({ status: "waiting", nextSendAt, updatedAt: new Date() })
        .where(eq(schema.sequenceEnrollments.id, id)),
    ),
  );
}

/** Sends the warm-intro handoff notification to userSettings.warmIntroEmail. */
async function sendWarmIntroHandoff(
  ctx: ReplyContext,
  message: typeof schema.mailboxMessages.$inferSelect,
  intent: ReplyIntent,
): Promise<{ ok: boolean; error?: string }> {
  const [settings] = await adminDb
    .select({
      warmIntroEmail: schema.userSettings.warmIntroEmail,
      warmIntroName: schema.userSettings.warmIntroName,
      fromName: schema.userSettings.fromName,
      replyToEmail: schema.userSettings.replyToEmail,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, ctx.clerkUserId))
    .limit(1);

  if (!settings?.warmIntroEmail) {
    return {
      ok: false,
      error: "No warmIntroEmail configured in userSettings — cannot hand off.",
    };
  }

  const [person] = await adminDb
    .select({
      name: schema.people.name,
      title: schema.people.title,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
    })
    .from(schema.people)
    .where(eq(schema.people.id, ctx.personId))
    .limit(1);

  const [campaign] = await adminDb
    .select({ name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, ctx.campaignId))
    .limit(1);

  const greeting = settings.warmIntroName
    ? `Hi ${settings.warmIntroName},`
    : "Hi,";
  const contactEmail =
    person?.workEmail ??
    person?.personalEmail ??
    message.fromAddress ??
    "(unknown)";
  const intentLabel =
    intent === "meeting_request"
      ? "wants to schedule a meeting"
      : "is interested";

  const subject = `Warm intro: ${person?.name ?? contactEmail} ${intentLabel} (${campaign?.name ?? "campaign"})`;
  const bodyHtml = `<p>${greeting}</p>
<p><strong>${person?.name ?? "A prospect"}</strong>${person?.title ? ` (${person.title})` : ""} replied to our outreach and ${intentLabel}.</p>
<p><strong>Contact:</strong> ${contactEmail}<br/>
<strong>Campaign:</strong> ${campaign?.name ?? "(unknown)"}</p>
<p><strong>Their reply:</strong></p>
<blockquote>${(message.body ?? message.snippet ?? "").slice(0, 4000)}</blockquote>
<p>Please follow up directly.</p>`;
  const bodyText = `${greeting}\n\n${person?.name ?? "A prospect"}${person?.title ? ` (${person.title})` : ""} replied to our outreach and ${intentLabel}.\n\nContact: ${contactEmail}\nCampaign: ${campaign?.name ?? "(unknown)"}\n\nTheir reply:\n${(message.body ?? message.snippet ?? "").slice(0, 4000)}\n\nPlease follow up directly.`;

  try {
    const mailboxRow = await getDefaultMailboxRow(ctx.clerkUserId);
    if (mailboxRow) {
      const connector = getConnectorForRow(mailboxRow);
      await connector.send({
        to: settings.warmIntroEmail,
        subject,
        html: bodyHtml,
        text: bodyText,
        replyTo: settings.replyToEmail ?? undefined,
      });
      return { ok: true };
    }

    const provider = getEmailProvider();
    if (!provider.enabled) {
      return {
        ok: false,
        error: "No mailbox connected and email provider is disabled.",
      };
    }
    const result = await provider.send({
      to: settings.warmIntroEmail,
      from: settings.fromName ?? "ChampHarbinger",
      subject,
      html: bodyHtml,
      text: bodyText,
      replyTo: settings.replyToEmail ?? undefined,
    });
    if (result.status === "failed") {
      return { ok: false, error: result.error ?? "send failed" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "warm intro send failed",
    };
  }
}

/** Drafts a contextual reply for question/objection/not_now and queues it for review. */
async function draftContextualReply(
  ctx: ReplyContext,
  message: typeof schema.mailboxMessages.$inferSelect,
  intent: ReplyIntent,
  haltedEnrollmentIds: string[],
): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const [person, campaign, settings] = await Promise.all([
    adminDb
      .select({
        name: schema.people.name,
        title: schema.people.title,
        workEmail: schema.people.workEmail,
        personalEmail: schema.people.personalEmail,
        enrichmentData: schema.people.enrichmentData,
        organizationId: schema.people.organizationId,
      })
      .from(schema.people)
      .where(eq(schema.people.id, ctx.personId))
      .limit(1)
      .then((r) => r[0] ?? null),
    adminDb
      .select({
        name: schema.campaigns.name,
        icp: schema.campaigns.icp,
        offering: schema.campaigns.offering,
        positioning: schema.campaigns.positioning,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, ctx.campaignId))
      .limit(1)
      .then((r) => r[0] ?? null),
    adminDb
      .select({ fromName: schema.userSettings.fromName })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.clerkUserId, ctx.clerkUserId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const orgRow = person?.organizationId
    ? await adminDb
        .select({
          name: schema.organizations.name,
          domain: schema.organizations.domain,
          industry: schema.organizations.industry,
          enrichmentData: schema.organizations.enrichmentData,
        })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, person.organizationId))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  const toEmail =
    person?.workEmail ?? person?.personalEmail ?? message.fromAddress;
  if (!toEmail) {
    return { ok: false, error: "No reply-to email address available." };
  }

  const personContext = await tryGetPersonContext(ctx.personId);

  const intentGuidance: Record<
    Extract<ReplyIntent, "question" | "objection" | "not_now">,
    string
  > = {
    question:
      "The prospect asked a question in their reply. Answer it directly and concisely, then re-offer a light next step.",
    objection:
      "The prospect raised an objection or pushback. Acknowledge it genuinely, address it briefly without being pushy, and leave the door open.",
    not_now:
      "The prospect said the timing isn't right but didn't close the door. Acknowledge that, and suggest checking back later without being pushy.",
  };

  const composeInput: ComposeInput = {
    contact: {
      name: person?.name ?? null,
      title: person?.title ?? null,
      email: toEmail,
      enrichmentData: {
        ...(person?.enrichmentData ?? {}),
        ...(personContext ?? {}),
      },
    },
    company: orgRow
      ? {
          name: orgRow.name,
          domain: orgRow.domain,
          industry: orgRow.industry,
          enrichmentData: orgRow.enrichmentData ?? null,
        }
      : null,
    step: {
      stepNumber: 1,
      totalSteps: 1,
      condition: "reply",
      isFinal: true,
    },
    campaign: {
      name: campaign?.name ?? "Campaign",
      icp: campaign?.icp ?? null,
      offering: campaign?.offering ?? null,
      positioning: campaign?.positioning ?? null,
    },
    senderProfile: {
      name: settings?.fromName ?? null,
      title: null,
      company: null,
      signature: null,
    },
    previousSubject: ctx.originalSubject,
    triggerReason: `The prospect just replied to our previous email. Reply intent detected: "${intent}". ${intentGuidance[intent as "question" | "objection" | "not_now"]}\n\nTHEIR REPLY:\n${(message.body ?? message.snippet ?? "").slice(0, 4000)}`,
  };

  const composed = await composeEmail(composeInput);
  if (!composed.ok) {
    return { ok: false, error: composed.error };
  }

  const [cp] = await adminDb
    .select({ id: schema.campaignPeople.id })
    .from(schema.campaignPeople)
    .where(eq(schema.campaignPeople.id, ctx.campaignPeopleId))
    .limit(1);
  if (!cp) {
    return { ok: false, error: "campaignPeople row not found." };
  }

  const [draft] = await adminDb
    .insert(schema.emailDrafts)
    .values({
      clerkUserId: ctx.clerkUserId,
      clerkOrgId: ctx.clerkOrgId,
      campaignId: ctx.campaignId,
      personId: ctx.personId,
      campaignPeopleId: cp.id,
      toEmail,
      subject: composed.email.subject.startsWith("Re:")
        ? composed.email.subject
        : `Re: ${ctx.originalSubject}`,
      bodyHtml: composed.email.bodyHtml,
      bodyText: composed.email.bodyText,
      // Not part of a sequence step — this is a reply draft. enrollmentId is
      // kept for traceability back to whichever enrollment(s) were halted.
      enrollmentId: haltedEnrollmentIds[0] ?? null,
      aiReasoning: `[reply intent: ${intent}] ${composed.email.aiReasoning}`,
      status: "draft",
      // Always "pending" — a reply draft always needs a human's eyes,
      // regardless of userSettings.aisdrMode (which governs cold outreach
      // pacing, not reply handling).
      reviewStatus: "pending",
    })
    .returning({ id: schema.emailDrafts.id });

  if (!draft) {
    return { ok: false, error: "Insert returned no row." };
  }

  return { ok: true, draftId: draft.id };
}

/**
 * The single entry point for reply handling. On ANY reply, halts every
 * sequence enrollment for the contact FIRST — unconditionally, before
 * classification or drafting even begins. Then classifies (guarded) and
 * branches by intent.
 */
export async function handleInboundMessage(
  mailboxMessageId: string,
): Promise<HandleInboundResult> {
  const [message] = await adminDb
    .select()
    .from(schema.mailboxMessages)
    .where(eq(schema.mailboxMessages.id, mailboxMessageId))
    .limit(1);

  if (!message) {
    return {
      ok: false,
      mailboxMessageId,
      error: "mailboxMessage not found",
    };
  }

  // ── STEP 1: HALT. Unconditional, first, before try/catch. ──────────────
  const { context, haltedEnrollmentIds } = await haltOnReply(message);

  if (!context) {
    // Not a reply to a sent email we track (or the link is broken) — there
    // is nothing to halt and no sequence context to draft/handoff against.
    return {
      ok: true,
      mailboxMessageId,
      haltedEnrollmentIds: [],
      action: "no_sequence_context",
    };
  }

  // ── STEP 2: classify. Guarded — a throw here must NOT undo the halt. ───
  let intent: ReplyIntent;
  let confidence: number;
  let classificationFailed = false;
  try {
    const result = await classifyReply({
      subject: message.subject,
      body: message.body,
      fromAddress: message.fromAddress,
    });
    intent = result.intent;
    confidence = result.confidence;
  } catch (err) {
    console.error("[aisdr/respond] classification failed:", err);
    classificationFailed = true;
    // Safe default: route to a human rather than guess. The enrollment is
    // already halted above regardless of this fallback.
    intent = "question";
    confidence = 0;
  }

  const base: HandleInboundResult = {
    ok: true,
    mailboxMessageId,
    intent,
    confidence,
    classificationFailed,
    haltedEnrollmentIds,
  };

  // ── STEP 3: branch by intent. ───────────────────────────────────────────
  switch (intent) {
    case "unsubscribe":
    case "wrong_person":
      // Stays halted permanently. Nothing further to do.
      return { ...base, action: "halted_only" };

    case "out_of_office":
      await rescheduleForOutOfOffice(haltedEnrollmentIds);
      return { ...base, action: "rescheduled" };

    case "interested":
    case "meeting_request": {
      const handoff = await sendWarmIntroHandoff(context, message, intent);
      return {
        ...base,
        action: handoff.ok ? "warm_intro_sent" : "warm_intro_failed",
        error: handoff.ok ? undefined : handoff.error,
      };
    }

    case "question":
    case "objection":
    case "not_now": {
      const drafted = await draftContextualReply(
        context,
        message,
        intent,
        haltedEnrollmentIds,
      );
      return {
        ...base,
        action: drafted.ok ? "drafted_reply" : "draft_failed",
        draftId: drafted.draftId,
        error: drafted.ok ? undefined : drafted.error,
      };
    }

    default: {
      // Exhaustiveness guard — should be unreachable given ReplyIntent.
      const _exhaustive: never = intent;
      return {
        ...base,
        action: "halted_only",
        error: `Unknown intent: ${_exhaustive}`,
      };
    }
  }
}

/**
 * Sends an approved reply draft (a draft created by draftContextualReply —
 * no `sequenceStepId`, so it falls outside the cadence-driven
 * `sendApprovedDraft`/`/api/outreach/send-now` path built for sequence
 * steps). Used by the review dashboard's "approve" action for AISDR reply
 * drafts specifically. Sequence-step drafts should keep going through the
 * existing outreach send-now path instead.
 */
export async function sendApprovedReplyDraft(
  draftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [draft] = await adminDb
    .select()
    .from(schema.emailDrafts)
    .where(eq(schema.emailDrafts.id, draftId))
    .limit(1);

  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.reviewStatus !== "approved") {
    return { ok: false, error: "Draft must be approved before it can be sent" };
  }
  if (draft.status !== "draft") {
    return { ok: false, error: `Draft is already ${draft.status}` };
  }
  if (draft.sequenceStepId) {
    return {
      ok: false,
      error:
        "This draft belongs to a sequence step — send it via /api/outreach/send-now instead.",
    };
  }

  const now = new Date();

  try {
    const mailboxRow = await getDefaultMailboxRow(draft.clerkUserId);
    let messageId: string;

    if (mailboxRow) {
      const connector = getConnectorForRow(mailboxRow);
      const res = await connector.send({
        to: draft.toEmail,
        subject: draft.subject,
        html: draft.bodyHtml,
        text: draft.bodyText ?? "",
      });
      messageId = res.messageId;
    } else {
      const provider = getEmailProvider();
      if (!provider.enabled) {
        return {
          ok: false,
          error:
            "Email sending is disabled. Connect a mailbox or configure ChampMail.",
        };
      }
      const [settings] = await adminDb
        .select({ fromName: schema.userSettings.fromName })
        .from(schema.userSettings)
        .where(eq(schema.userSettings.clerkUserId, draft.clerkUserId))
        .limit(1);
      const result = await provider.send({
        to: draft.toEmail,
        from: settings?.fromName ?? "ChampHarbinger",
        subject: draft.subject,
        html: draft.bodyHtml,
        text: draft.bodyText ?? "",
      });
      if (result.status === "failed") {
        return { ok: false, error: result.error ?? "Send failed" };
      }
      messageId = result.providerId ?? result.id;
    }

    await adminDb.insert(schema.sentEmails).values({
      agentmailMessageId: messageId,
      draftId: draft.id,
      campaignPeopleId: draft.campaignPeopleId,
      campaignId: draft.campaignId,
      personId: draft.personId,
      clerkUserId: draft.clerkUserId,
      clerkOrgId: draft.clerkOrgId,
      toEmail: draft.toEmail,
      fromEmail: mailboxRow?.fromAddress ?? "ChampHarbinger",
      subject: draft.subject,
      status: "sent",
      sentAt: now,
    });

    await adminDb
      .update(schema.emailDrafts)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(schema.emailDrafts.id, draft.id));

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed",
    };
  }
}
