import { tool } from "ai";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { adminDb as db } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailProvider } from "@/lib/email/provider";
import { trackUsage } from "@/lib/services/cost-tracker";
import { saveDraft } from "@/lib/email-composition/save";
import {
  applyPattern,
  emailMatchesName,
  getOrgPattern,
  inferPattern,
  isRolePrefix,
  makeEmailPatternDb,
  mxCheck,
  recomputeOrgPattern,
  recordVerifiedEmail,
  splitName,
  SOURCE_WEIGHT,
  type VerifiedEmail,
} from "@/lib/services/email-pattern";

// ── Shared findEmail logic ─────────────────────────────────────────────────

const PATTERN_CONFIDENCE_THRESHOLD = 0.5;
// Cap for pattern-derived confidence. Stays strictly below the UI's
// "verified" threshold (0.9) so a pattern guess can never display as verified.
const PATTERN_DERIVED_CONFIDENCE_FACTOR = 0.85;

export async function findEmailForPerson(personId: string): Promise<{
  email: string | null;
  source?: string;
  confidence?: number;
  reason?: string;
  personId: string;
}> {
  const [person] = await db
    .select({
      id: schema.people.id,
      name: schema.people.name,
      title: schema.people.title,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
      organizationId: schema.people.organizationId,
      workEmailSource: schema.people.workEmailSource,
      workEmailConfidence: schema.people.workEmailConfidence,
    })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (!person) {
    return { email: null, reason: "Person not found.", personId };
  }

  if (person.workEmail) {
    return {
      email: person.workEmail,
      source: person.workEmailSource ?? "existing",
      confidence: person.workEmailConfidence ?? undefined,
      personId,
    };
  }
  if (person.personalEmail) {
    return { email: person.personalEmail, source: "existing", personId };
  }

  let domain: string | null = null;
  if (person.organizationId) {
    const [org] = await db
      .select({ domain: schema.organizations.domain })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, person.organizationId))
      .limit(1);
    domain = org?.domain ?? null;
  }

  const { first, last } = splitName(person.name);
  const epDb = makeEmailPatternDb(db);

  // ── 1) Pattern-first: if the org has a confident pattern, derive + MX-check.
  if (domain && person.organizationId && first) {
    const orgPattern = await getOrgPattern(epDb, person.organizationId);
    if (
      orgPattern?.pattern &&
      orgPattern.confidence >= PATTERN_CONFIDENCE_THRESHOLD
    ) {
      const derived = applyPattern(orgPattern.pattern, first, last, domain);
      if (
        derived &&
        !isRolePrefix(derived.split("@")[0]) &&
        emailMatchesName(derived, first, last)
      ) {
        const mxOk = await mxCheck(domain);
        if (mxOk) {
          const confidence =
            orgPattern.confidence * PATTERN_DERIVED_CONFIDENCE_FACTOR;
          await db
            .update(schema.people)
            .set({
              workEmail: derived,
              workEmailSource: "pattern_derived",
              workEmailConfidence: confidence,
            })
            .where(eq(schema.people.id, personId));
          return {
            email: derived,
            source: "pattern_derived",
            confidence,
            personId,
          };
        }
      }
    }
  }

  // ── 2) Discovery path — no external search available; fall through to pattern inference.
  const foundEmail: string | null = null;

  // ── 3) On-the-fly inference: try inferring the pattern from
  //       any verified emails on the org RIGHT NOW.
  if (!foundEmail && domain && person.organizationId && first && last) {
    const orgPeople = await db
      .select({
        name: schema.people.name,
        workEmail: schema.people.workEmail,
        workEmailSource: schema.people.workEmailSource,
        workEmailVerifiedAt: schema.people.workEmailVerifiedAt,
      })
      .from(schema.people)
      .where(and(eq(schema.people.organizationId, person.organizationId)));

    const evidence: VerifiedEmail[] = [];
    for (const p of orgPeople) {
      if (!p.workEmail || !p.workEmailSource) continue;
      if (p.workEmailSource === "pattern_derived") continue;
      if (!p.workEmailVerifiedAt) continue;
      const split = splitName(p.name);
      if (!split.first || !split.last) continue;
      evidence.push({
        email: p.workEmail,
        firstName: split.first,
        lastName: split.last,
        source: p.workEmailSource as VerifiedEmail["source"],
      });
    }

    if (evidence.length > 0) {
      const inferred = inferPattern(evidence);
      if (inferred.pattern) {
        const derived = applyPattern(inferred.pattern, first, last, domain);
        if (
          derived &&
          !isRolePrefix(derived.split("@")[0]) &&
          emailMatchesName(derived, first, last) &&
          (await mxCheck(domain))
        ) {
          const confidence =
            inferred.confidence * PATTERN_DERIVED_CONFIDENCE_FACTOR;
          await db
            .update(schema.people)
            .set({
              workEmail: derived,
              workEmailSource: "pattern_derived",
              workEmailConfidence: confidence,
            })
            .where(eq(schema.people.id, personId));
          // Refresh the org's cached pattern so subsequent lookups in a bulk
          // run hit step 1 instead of re-doing this query.
          await recomputeOrgPattern(epDb, person.organizationId);
          return {
            email: derived,
            source: "pattern_derived",
            confidence,
            personId,
          };
        }
      }
    }
  }

  // ── 4) Final fallback: blind {first}.{last}@domain.
  if (!foundEmail && domain && first && last) {
    const blind = applyPattern("{first}.{last}", first, last, domain);
    if (
      blind &&
      !isRolePrefix(blind.split("@")[0]) &&
      emailMatchesName(blind, first, last) &&
      (await mxCheck(domain))
    ) {
      await db
        .update(schema.people)
        .set({
          workEmail: blind,
          workEmailSource: "pattern_derived",
          workEmailConfidence: 0.2,
        })
        .where(eq(schema.people.id, personId));
      return {
        email: blind,
        source: "pattern_derived",
        confidence: 0.2,
        personId,
      };
    }
  }

  return {
    email: null,
    reason: "Could not find an email address.",
    personId,
  };
}

// ── findEmail ──────────────────────────────────────────────────────────────

export const findEmail = tool({
  description:
    "Discover the email address for a contact using email pattern inference and DNS MX checking. Returns the email if already known. Use this before writeEmail if the contact has no email.",
  inputSchema: z.object({
    personId: z.string().uuid().describe("Person ID to find email for."),
  }),
  execute: async ({ personId }) => findEmailForPerson(personId),
});

// ── findEmails (batch) ─────────────────────────────────────────────────────

export const findEmails = tool({
  description:
    "Batch-discover email addresses for multiple contacts. Skips contacts that already have emails. Returns found and not-found lists.",
  inputSchema: z.object({
    personIds: z.array(z.string().uuid()).describe("Array of person IDs."),
  }),
  execute: async ({ personIds }) => {
    const found: Array<{ personId: string; email: string }> = [];
    const notFound: string[] = [];

    for (const personId of personIds) {
      try {
        const result = await findEmailForPerson(personId);
        if (result.email) {
          found.push({ personId, email: result.email });
        } else {
          notFound.push(personId);
        }
      } catch {
        notFound.push(personId);
      }
    }

    return {
      found,
      notFound,
      summary: `Found emails for ${found.length} of ${personIds.length} contacts. ${notFound.length} not found.`,
    };
  },
});

// ── writeEmail ─────────────────────────────────────────────────────────────

export const writeEmail = tool({
  description:
    "Compose an email draft and save it to the database. This does NOT send the email -- it creates a draft for the user to review. The user must confirm before you call sendEmail.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    personId: z.string().uuid().describe("Person ID (from campaign contacts)."),
    subject: z.string().describe("Email subject line."),
    bodyHtml: z.string().describe("Email body as HTML."),
    bodyText: z
      .string()
      .optional()
      .describe("Plain text version of the email body."),
    sequenceId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence ID if this draft is part of a sequence."),
    sequenceStepId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence step ID for this draft."),
    enrollmentId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence enrollment ID for the contact."),
    aiReasoning: z
      .string()
      .optional()
      .describe("Explanation of why the email was written this way."),
  }),
  execute: async (input) => {
    const { getCurrentUser } = await import("@/lib/auth");
    const { userId, orgId } = await getCurrentUser();

    const result = await saveDraft({ ...input, userId, orgId });

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      draftId: result.draftId,
      to: result.to,
      subject: result.subject,
      status: "draft",
      message:
        "Draft saved. Show it to the user and wait for confirmation before calling sendEmail.",
    };
  },
});

// ── sendEmail ──────────────────────────────────────────────────────────────

export const sendEmail = tool({
  description:
    "Send a previously written email draft via the configured email provider. Only call this after the user has reviewed and confirmed the draft.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to send."),
  }),
  execute: async ({ draftId }) => {
    const [draft] = await db
      .select()
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.id, draftId))
      .limit(1);

    if (!draft) {
      return { error: "Draft not found." };
    }

    if (draft.status !== "draft") {
      return {
        error: `This draft has already been ${draft.status}. Cannot send again.`,
      };
    }

    const [settings] = await db
      .select({
        fromName: schema.userSettings.fromName,
        replyToEmail: schema.userSettings.replyToEmail,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.clerkUserId, draft.clerkUserId))
      .limit(1);

    const emailProvider = getEmailProvider();
    if (!emailProvider.enabled) {
      return {
        error:
          "Email sending is disabled. Configure ChampMail or another provider in Settings > Email to enable.",
      };
    }

    let messageId: string;
    try {
      const result = await emailProvider.send({
        to: draft.toEmail,
        from: settings?.fromName ?? "ChampHarbinger",
        subject: draft.subject,
        html: draft.bodyHtml,
        text: draft.bodyText ?? "",
        replyTo: settings?.replyToEmail ?? undefined,
      });
      if (result.status === "failed") {
        return {
          error: `Failed to send email: ${result.error ?? "Unknown error"}`,
        };
      }
      messageId = result.providerId ?? result.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { error: `Failed to send email: ${msg}` };
    }

    const now = new Date();

    await db.insert(schema.sentEmails).values({
      agentmailMessageId: messageId,
      agentmailThreadId: null,
      draftId,
      campaignPeopleId: draft.campaignPeopleId,
      campaignId: draft.campaignId,
      personId: draft.personId,
      clerkUserId: draft.clerkUserId,
      clerkOrgId: draft.clerkOrgId,
      toEmail: draft.toEmail,
      fromEmail: settings?.fromName ?? "ChampHarbinger",
      subject: draft.subject,
      status: "sent",
      sentAt: now,
    });

    await db
      .update(schema.emailDrafts)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(schema.emailDrafts.id, draftId));

    await db
      .update(schema.campaignPeople)
      .set({ outreachStatus: "sent" })
      .where(eq(schema.campaignPeople.id, draft.campaignPeopleId));

    trackUsage({
      service: "champmail",
      operation: "send-email",
      estimated_cost_usd: 0.0004,
      campaign_id: draft.campaignId,
      metadata: {
        draftId,
        to: draft.toEmail,
      },
    });

    return {
      emailId: messageId,
      to: draft.toEmail,
      subject: draft.subject,
      status: "sent",
    };
  },
});

// ── listDrafts ─────────────────────────────────────────────────────────────

export const listDrafts = tool({
  description: "List unsent email drafts, optionally filtered by campaign.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter drafts by campaign ID."),
  }),
  execute: async ({ campaignId }) => {
    const { getScopedDb } = await import("@/lib/db/scoped");
    const sdb = await getScopedDb();

    const rows = await sdb.raw
      .select({
        id: schema.emailDrafts.id,
        campaignId: schema.emailDrafts.campaignId,
        personId: schema.emailDrafts.personId,
        toEmail: schema.emailDrafts.toEmail,
        subject: schema.emailDrafts.subject,
        status: schema.emailDrafts.status,
        createdAt: schema.emailDrafts.createdAt,
      })
      .from(schema.emailDrafts)
      .where(
        and(
          eq(schema.emailDrafts.status, "draft"),
          campaignId
            ? eq(schema.emailDrafts.campaignId, campaignId)
            : eq(schema.emailDrafts.clerkUserId, sdb.userId),
        ),
      )
      .orderBy(schema.emailDrafts.createdAt);

    return { drafts: rows, count: rows.length };
  },
});

// ── discardDraft ───────────────────────────────────────────────────────────

export const discardDraft = tool({
  description: "Discard an email draft so it won't be sent.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to discard."),
  }),
  execute: async ({ draftId }) => {
    await db
      .update(schema.emailDrafts)
      .set({ status: "discarded", updatedAt: new Date() })
      .where(
        and(
          eq(schema.emailDrafts.id, draftId),
          eq(schema.emailDrafts.status, "draft"),
        ),
      );

    return { draftId, status: "discarded" };
  },
});

// ── sendBulkEmails ─────────────────────────────────────────────────────────

export const sendBulkEmails = tool({
  description:
    "Send multiple email drafts at once. If no draftIds provided, sends all unsent drafts for the campaign. Only call after user confirms sending all drafts.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    draftIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        "Specific draft IDs to send. If omitted, sends all drafts for the campaign.",
      ),
  }),
  execute: async ({ campaignId, draftIds }) => {
    const { inArray: drizzleInArray } = await import("drizzle-orm");

    const drafts = await db
      .select()
      .from(schema.emailDrafts)
      .where(
        and(
          eq(schema.emailDrafts.campaignId, campaignId),
          eq(schema.emailDrafts.status, "draft"),
          draftIds && draftIds.length > 0
            ? drizzleInArray(schema.emailDrafts.id, draftIds)
            : undefined,
        ),
      );

    if (drafts.length === 0) {
      return { error: "No drafts found to send." };
    }

    const emailProvider = getEmailProvider();
    if (!emailProvider.enabled) {
      return {
        error:
          "Email sending is disabled. Configure ChampMail or another provider in Settings > Email to enable.",
      };
    }

    const [settings] = await db
      .select({
        fromName: schema.userSettings.fromName,
        replyToEmail: schema.userSettings.replyToEmail,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.clerkUserId, drafts[0].clerkUserId))
      .limit(1);

    const results: Array<{ draftId: string; status: string; error?: string }> =
      [];

    for (const draft of drafts) {
      try {
        const sendResult = await emailProvider.send({
          to: draft.toEmail,
          from: settings?.fromName ?? "ChampHarbinger",
          subject: draft.subject,
          html: draft.bodyHtml,
          text: draft.bodyText ?? "",
          replyTo: settings?.replyToEmail ?? undefined,
        });

        if (sendResult.status === "failed") {
          results.push({
            draftId: draft.id,
            status: "failed",
            error: sendResult.error,
          });
          continue;
        }

        const messageId = sendResult.providerId ?? sendResult.id;
        const now = new Date();

        await db.insert(schema.sentEmails).values({
          agentmailMessageId: messageId,
          agentmailThreadId: null,
          draftId: draft.id,
          campaignPeopleId: draft.campaignPeopleId,
          campaignId: draft.campaignId,
          personId: draft.personId,
          clerkUserId: draft.clerkUserId,
          clerkOrgId: draft.clerkOrgId,
          toEmail: draft.toEmail,
          fromEmail: settings?.fromName ?? "ChampHarbinger",
          subject: draft.subject,
          status: "sent",
          sentAt: now,
        });

        await db
          .update(schema.emailDrafts)
          .set({ status: "sent", sentAt: now, updatedAt: now })
          .where(eq(schema.emailDrafts.id, draft.id));

        await db
          .update(schema.campaignPeople)
          .set({ outreachStatus: "sent" })
          .where(eq(schema.campaignPeople.id, draft.campaignPeopleId));

        trackUsage({
          service: "champmail",
          operation: "send-email",
          estimated_cost_usd: 0.0004,
          campaign_id: campaignId,
          metadata: { draftId: draft.id, to: draft.toEmail },
        });

        results.push({ draftId: draft.id, status: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ draftId: draft.id, status: "failed", error: msg });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return {
      sent,
      failed,
      total: drafts.length,
      results,
      summary: `Sent ${sent} of ${drafts.length} emails.${failed > 0 ? ` ${failed} failed.` : ""}`,
    };
  },
});
