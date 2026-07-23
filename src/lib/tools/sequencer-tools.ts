import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { getScopedDb } from "@/lib/db/scoped";
import {
  findOrCreateOrganization,
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import {
  getConnectorForRow,
  getDefaultMailboxRow,
  type MailboxConnectionRow,
} from "@/lib/mailbox/registry";
import {
  GuardrailViolationError,
  runSendGuardrails,
  type MailboxForGuardrails,
} from "@/lib/sequencing/guardrails";

/**
 * Sequencer tools — "Port C: The Sequencer". These are the ONLY interface
 * the rest of the system should use to move a lead through outreach:
 * create_lead -> enroll_in_sequence -> send_message, plus check_replies to
 * read back inbound responses. They wrap the existing sequences /
 * sequence_enrollments / sent_emails / mailbox_messages tables directly —
 * no parallel state is introduced here.
 *
 * send_message is the single choke point for actually sending mail. It
 * calls `runSendGuardrails` unconditionally before touching a mailbox
 * connector — the daily cap, randomized throttle, and SPF/DKIM/DMARC domain
 * check in src/lib/sequencing/guardrails.ts cannot be skipped from here.
 */

// ── create_lead ──────────────────────────────────────────────────────────

export const createLead = tool({
  description:
    "Create (or find/update) a lead — a person plus optional organization — and attach them to a campaign as a contact ready for sequencing. Idempotent: re-calling with the same LinkedIn URL or org domain updates the existing record instead of duplicating it.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign this lead belongs to."),
    name: z.string().min(1).describe("Lead's full name."),
    email: z
      .string()
      .email()
      .optional()
      .describe("Work email if known. Saved as the lead's work email."),
    title: z.string().optional().describe("Job title."),
    linkedinUrl: z.string().url().optional().describe("LinkedIn profile URL."),
    organizationName: z
      .string()
      .optional()
      .describe("Company name. Required to attach an organization."),
    organizationDomain: z
      .string()
      .optional()
      .describe("Company domain, e.g. 'acme.com'."),
  }),
  execute: async ({
    campaignId,
    name,
    email,
    title,
    linkedinUrl,
    organizationName,
    organizationDomain,
  }) => {
    const sdb = await getScopedDb();

    const [campaign] = await sdb.raw
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, campaignId),
          eq(schema.campaigns.clerkUserId, sdb.userId),
        ),
      )
      .limit(1);
    if (!campaign) {
      return { error: "Campaign not found or not owned by this user." };
    }

    let organizationId: string | null = null;
    if (organizationName) {
      const org = await findOrCreateOrganization({
        name: organizationName,
        domain: organizationDomain ?? null,
        source: "sequencer_create_lead",
      });
      organizationId = org.id;
    }

    const person = await findOrCreatePerson({
      name,
      work_email: email ?? null,
      linkedin_url: linkedinUrl ?? null,
      title: title ?? null,
      organization_id: organizationId,
      source: "sequencer_create_lead",
    });

    const link = await linkPersonToCampaign(person.id, campaignId);

    return {
      personId: person.id,
      campaignPeopleId: link.id,
      organizationId,
      message: `Lead "${name}" created and attached to campaign. Use enroll_in_sequence to start outreach.`,
    };
  },
});

// ── enroll_in_sequence ───────────────────────────────────────────────────

export const enrollInSequence = tool({
  description:
    "Enroll a lead (campaign contact) in an outreach sequence. The lead must already be attached to the sequence's campaign (via create_lead). No-op if already enrolled.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence to enroll into."),
    campaignPeopleId: z
      .string()
      .uuid()
      .describe("campaign_people ID (returned by create_lead)."),
  }),
  execute: async ({ sequenceId, campaignPeopleId }) => {
    const sdb = await getScopedDb();

    const [sequence] = await sdb.raw
      .select({
        id: schema.sequences.id,
        campaignId: schema.sequences.campaignId,
        status: schema.sequences.status,
      })
      .from(schema.sequences)
      .where(
        and(
          eq(schema.sequences.id, sequenceId),
          eq(schema.sequences.clerkUserId, sdb.userId),
        ),
      )
      .limit(1);
    if (!sequence) {
      return { error: "Sequence not found or not owned by this user." };
    }

    const [contact] = await sdb.raw
      .select({
        id: schema.campaignPeople.id,
        personId: schema.campaignPeople.personId,
        campaignId: schema.campaignPeople.campaignId,
      })
      .from(schema.campaignPeople)
      .where(eq(schema.campaignPeople.id, campaignPeopleId))
      .limit(1);
    if (!contact) {
      return { error: "campaign_people row not found." };
    }
    if (contact.campaignId !== sequence.campaignId) {
      return {
        error:
          "This lead belongs to a different campaign than the sequence — enroll it in a sequence on the same campaign.",
      };
    }

    const [existing] = await sdb.raw
      .select({
        id: schema.sequenceEnrollments.id,
        status: schema.sequenceEnrollments.status,
      })
      .from(schema.sequenceEnrollments)
      .where(
        and(
          eq(schema.sequenceEnrollments.sequenceId, sequenceId),
          eq(schema.sequenceEnrollments.campaignPeopleId, campaignPeopleId),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        enrollmentId: existing.id,
        status: existing.status,
        message: "Already enrolled — no changes made.",
      };
    }

    const [enrollment] = await sdb.raw
      .insert(schema.sequenceEnrollments)
      .values({
        sequenceId,
        campaignPeopleId,
        personId: contact.personId,
        currentStep: 1,
        status: "queued",
        waitingSince: new Date(),
      })
      .returning({ id: schema.sequenceEnrollments.id });

    if (!enrollment) return { error: "Failed to create enrollment." };

    return {
      enrollmentId: enrollment.id,
      status: "queued",
      message:
        "Lead enrolled. Use send_message to send step 1 once a draft is ready.",
    };
  },
});

// ── send_message ─────────────────────────────────────────────────────────

async function loadMailboxRow(
  userId: string,
  mailboxConnectionId?: string,
): Promise<MailboxConnectionRow | null> {
  if (mailboxConnectionId) {
    const [row] = await adminDb
      .select()
      .from(schema.mailboxConnections)
      .where(
        and(
          eq(schema.mailboxConnections.id, mailboxConnectionId),
          eq(schema.mailboxConnections.clerkUserId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  return getDefaultMailboxRow(userId);
}

export const sendMessage = tool({
  description:
    "Send an outreach email from a connected mailbox. This is the ONLY path in the system that actually sends mail for a sequenced lead — it enforces the daily send cap, a randomized inter-send throttle, and (for InboxKit-provisioned domains) an SPF/DKIM/DMARC health check before sending. All three are hard-enforced here; there is no parameter that bypasses them.",
  inputSchema: z.object({
    campaignPeopleId: z
      .string()
      .uuid()
      .describe("campaign_people ID of the recipient."),
    subject: z.string().min(1).describe("Email subject line."),
    bodyHtml: z.string().min(1).describe("Email body as HTML."),
    bodyText: z.string().optional().describe("Plain-text body (recommended)."),
    mailboxConnectionId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Mailbox to send from. Defaults to the user's default mailbox.",
      ),
    enrollmentId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence enrollment ID — advances currentStep on success."),
    sequenceStepId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence step this message fulfills, for record-keeping."),
    draftId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "If sending a previously written draft, its ID — marks it sent.",
      ),
  }),
  execute: async ({
    campaignPeopleId,
    subject,
    bodyHtml,
    bodyText,
    mailboxConnectionId,
    enrollmentId,
    sequenceStepId,
    draftId,
  }) => {
    const sdb = await getScopedDb();
    const userId = sdb.userId;

    const [contact] = await sdb.raw
      .select({
        id: schema.campaignPeople.id,
        personId: schema.campaignPeople.personId,
        campaignId: schema.campaignPeople.campaignId,
      })
      .from(schema.campaignPeople)
      .where(eq(schema.campaignPeople.id, campaignPeopleId))
      .limit(1);
    if (!contact) return { error: "campaign_people row not found." };

    const [person] = await sdb.raw
      .select({
        id: schema.people.id,
        workEmail: schema.people.workEmail,
        personalEmail: schema.people.personalEmail,
      })
      .from(schema.people)
      .where(eq(schema.people.id, contact.personId))
      .limit(1);
    const toEmail = person?.workEmail ?? person?.personalEmail;
    if (!toEmail) {
      return { error: "This lead has no email on file. Run findEmail first." };
    }

    const mailboxRow = await loadMailboxRow(userId, mailboxConnectionId);
    if (!mailboxRow) {
      return {
        error:
          "No active mailbox connection found. Connect a mailbox in Settings first.",
      };
    }
    if (mailboxRow.status !== "active") {
      return {
        error: `Mailbox ${mailboxRow.fromAddress} is not active (status: ${mailboxRow.status}).`,
      };
    }

    const guardrailMailbox: MailboxForGuardrails = {
      id: mailboxRow.id,
      clerkUserId: mailboxRow.clerkUserId,
      fromAddress: mailboxRow.fromAddress,
      config: mailboxRow.config as Record<string, unknown> | null,
    };

    try {
      await runSendGuardrails(guardrailMailbox);
    } catch (err) {
      if (err instanceof GuardrailViolationError) {
        return { error: err.message, guardrail: err.code };
      }
      throw err;
    }

    const connector = getConnectorForRow(mailboxRow);
    const sendResult = await connector.send({
      to: toEmail,
      subject,
      text: bodyText ?? "",
      html: bodyHtml,
    });

    const now = new Date();
    await adminDb.insert(schema.sentEmails).values({
      agentmailMessageId: sendResult.messageId,
      draftId: draftId ?? null,
      campaignPeopleId,
      campaignId: contact.campaignId,
      personId: contact.personId,
      clerkUserId: userId,
      clerkOrgId: sdb.orgId,
      toEmail,
      fromEmail: mailboxRow.fromAddress,
      subject,
      status: "sent",
      sentAt: now,
    });

    if (draftId) {
      await adminDb
        .update(schema.emailDrafts)
        .set({ status: "sent", sentAt: now, updatedAt: now })
        .where(eq(schema.emailDrafts.id, draftId));
    }

    await adminDb
      .update(schema.campaignPeople)
      .set({ outreachStatus: "sent" })
      .where(eq(schema.campaignPeople.id, campaignPeopleId));

    if (enrollmentId) {
      const [enrollment] = await adminDb
        .select({ currentStep: schema.sequenceEnrollments.currentStep })
        .from(schema.sequenceEnrollments)
        .where(eq(schema.sequenceEnrollments.id, enrollmentId))
        .limit(1);
      if (enrollment) {
        await adminDb
          .update(schema.sequenceEnrollments)
          .set({
            currentStep: enrollment.currentStep + 1,
            status: "waiting",
            waitingSince: now,
            updatedAt: now,
          })
          .where(eq(schema.sequenceEnrollments.id, enrollmentId));
      }
    }

    return {
      messageId: sendResult.messageId,
      to: toEmail,
      from: mailboxRow.fromAddress,
      subject,
      status: "sent",
      sequenceStepId: sequenceStepId ?? null,
    };
  },
});

// ── check_replies ────────────────────────────────────────────────────────

export const checkReplies = tool({
  description:
    "Read inbound replies synced from the user's connected mailboxes. Filter by a specific lead (campaignPeopleId) to see just that thread, or omit it to see the most recent replies across all mailboxes.",
  inputSchema: z.object({
    campaignPeopleId: z
      .string()
      .uuid()
      .optional()
      .describe("Restrict to replies tied to this lead's sent emails."),
    mailboxConnectionId: z
      .string()
      .uuid()
      .optional()
      .describe("Restrict to one mailbox connection."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max messages to return."),
  }),
  execute: async ({ campaignPeopleId, mailboxConnectionId, limit }) => {
    const sdb = await getScopedDb();

    if (campaignPeopleId) {
      const rows = await sdb.raw
        .select({
          id: schema.mailboxMessages.id,
          fromAddress: schema.mailboxMessages.fromAddress,
          toAddress: schema.mailboxMessages.toAddress,
          subject: schema.mailboxMessages.subject,
          snippet: schema.mailboxMessages.snippet,
          body: schema.mailboxMessages.body,
          receivedAt: schema.mailboxMessages.receivedAt,
          sentEmailId: schema.mailboxMessages.sentEmailId,
        })
        .from(schema.mailboxMessages)
        .innerJoin(
          schema.sentEmails,
          eq(schema.mailboxMessages.sentEmailId, schema.sentEmails.id),
        )
        .where(
          and(
            eq(schema.mailboxMessages.clerkUserId, sdb.userId),
            eq(schema.sentEmails.campaignPeopleId, campaignPeopleId),
          ),
        )
        .orderBy(desc(schema.mailboxMessages.receivedAt))
        .limit(limit);

      return {
        replies: rows,
        count: rows.length,
        hasReply: rows.length > 0,
      };
    }

    const rows = await sdb.raw
      .select({
        id: schema.mailboxMessages.id,
        connectionId: schema.mailboxMessages.connectionId,
        fromAddress: schema.mailboxMessages.fromAddress,
        toAddress: schema.mailboxMessages.toAddress,
        subject: schema.mailboxMessages.subject,
        snippet: schema.mailboxMessages.snippet,
        receivedAt: schema.mailboxMessages.receivedAt,
        sentEmailId: schema.mailboxMessages.sentEmailId,
      })
      .from(schema.mailboxMessages)
      .where(
        and(
          eq(schema.mailboxMessages.clerkUserId, sdb.userId),
          mailboxConnectionId
            ? eq(schema.mailboxMessages.connectionId, mailboxConnectionId)
            : undefined,
        ),
      )
      .orderBy(desc(schema.mailboxMessages.receivedAt))
      .limit(limit);

    return { replies: rows, count: rows.length };
  },
});
