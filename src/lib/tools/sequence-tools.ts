import { tool } from "ai";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { db } from "@/db";
import { composeEmail, mapConcurrent } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { saveDraft } from "@/lib/email-composition/save";

export const createSequence = tool({
  description:
    "Create an outreach sequence with steps. Step 1 is triggered by a signal (e.g. hiring activity). Follow-up steps are time-delayed with conditions. Enrolls contacts automatically.",
  inputSchema: z.object({
    name: z.string().describe("Sequence name, e.g. 'Cold Outreach v1'."),
    campaignId: z.string().uuid().describe("Campaign ID."),
    triggerSignalId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Signal ID that triggers the first email. Omit for immediate send after approval.",
      ),
    steps: z
      .array(
        z.object({
          delayDays: z
            .number()
            .int()
            .optional()
            .describe("Days to wait after previous step."),
          delayHours: z
            .number()
            .int()
            .optional()
            .describe("Hours to wait after previous step."),
          condition: z
            .enum(["no_reply", "no_open", "opened_no_reply", "always"])
            .default("no_reply")
            .describe("Condition for sending this step."),
        }),
      )
      .describe(
        "Sequence steps. First step has no delay (signal-triggered). Follow-ups have delays + conditions.",
      ),
    contactIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        "Specific campaign_people IDs to enroll. If omitted, enrolls all contacts in the campaign (emails are still reviewed before send).",
      ),
  }),
  execute: async ({ name, campaignId, triggerSignalId, steps, contactIds }) => {
    const sdb = await getScopedDb();

    // Create the sequence
    const [sequence] = await sdb.raw
      .insert(schema.sequences)
      .values({
        name,
        campaignId,
        triggerSignalId: triggerSignalId ?? null,
        status: "draft",
        clerkUserId: sdb.userId,
        clerkOrgId: sdb.orgId,
      })
      .returning({ id: schema.sequences.id });

    if (!sequence) {
      return { error: "Failed to create sequence" };
    }

    // Create steps
    const stepRows = steps.map((step, i) => ({
      sequenceId: sequence.id,
      stepNumber: i + 1,
      stepType: "email" as const,
      delayDays: i === 0 ? null : (step.delayDays ?? null),
      delayHours: i === 0 ? null : (step.delayHours ?? null),
      condition: i === 0 ? "always" : step.condition,
    }));

    await sdb.raw.insert(schema.sequenceSteps).values(stepRows);

    // Enroll contacts
    let contacts;
    if (contactIds && contactIds.length > 0) {
      contacts = await sdb.raw
        .select({ id: schema.campaignPeople.id, personId: schema.campaignPeople.personId })
        .from(schema.campaignPeople)
        .where(
          and(
            eq(schema.campaignPeople.campaignId, campaignId),
            inArray(schema.campaignPeople.id, contactIds),
          ),
        );
    } else {
      // Enroll all contacts -- emails are still reviewed before send
      contacts = await sdb.raw
        .select({ id: schema.campaignPeople.id, personId: schema.campaignPeople.personId })
        .from(schema.campaignPeople)
        .where(eq(schema.campaignPeople.campaignId, campaignId));
    }

    if (!contacts || contacts.length === 0) {
      return {
        sequenceId: sequence.id,
        enrolled: 0,
        message:
          "Sequence created but no contacts to enroll -- the campaign has no contacts yet.",
      };
    }

    const enrollments = contacts.map((c) => ({
      sequenceId: sequence.id,
      campaignPeopleId: c.id,
      personId: c.personId,
      currentStep: 1,
      status: triggerSignalId ? "waiting" : "queued",
      waitingSince: new Date(),
    }));

    await sdb.raw.insert(schema.sequenceEnrollments).values(enrollments);

    return {
      sequenceId: sequence.id,
      steps: steps.length,
      enrolled: contacts.length,
      status: "draft",
      message: `Sequence "${name}" created with ${steps.length} steps and ${contacts.length} contacts enrolled. Now call draftSequenceEmails to generate personalized emails, then send the user to /outreach/review?sequence=${sequence.id} to approve them.`,
    };
  },
});

export const draftSequenceEmails = tool({
  description:
    "Draft personalized emails for all enrolled contacts in a sequence. Uses enrichment data, campaign context, and user profile to write each email. Returns a link to the review page. The AI should compose each email itself by calling writeEmail for each contact+step combination.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID to draft emails for."),
  }),
  execute: async ({ sequenceId }) => {
    const [sequence] = await db
      .select({
        id: schema.sequences.id,
        name: schema.sequences.name,
        campaignId: schema.sequences.campaignId,
      })
      .from(schema.sequences)
      .where(eq(schema.sequences.id, sequenceId))
      .limit(1);

    if (!sequence) {
      return { error: "Sequence not found." };
    }

    const steps = await db
      .select({
        id: schema.sequenceSteps.id,
        stepNumber: schema.sequenceSteps.stepNumber,
        delayDays: schema.sequenceSteps.delayDays,
        condition: schema.sequenceSteps.condition,
      })
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, sequenceId))
      .orderBy(schema.sequenceSteps.stepNumber);

    const enrollments = await db
      .select({
        id: schema.sequenceEnrollments.id,
        personId: schema.sequenceEnrollments.personId,
        campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId,
      })
      .from(schema.sequenceEnrollments)
      .where(eq(schema.sequenceEnrollments.sequenceId, sequenceId));

    if (!steps || steps.length === 0) {
      return { error: "No steps found for this sequence." };
    }

    if (!enrollments || enrollments.length === 0) {
      return { error: "No contacts enrolled in this sequence." };
    }

    // Load thin contact context for drafting
    const personIds = enrollments.map((e) => e.personId);
    const people = await db
      .select({
        id: schema.people.id,
        name: schema.people.name,
        title: schema.people.title,
        workEmail: schema.people.workEmail,
        personalEmail: schema.people.personalEmail,
        organizationId: schema.people.organizationId,
      })
      .from(schema.people)
      .where(inArray(schema.people.id, personIds));

    const orgIds = [...new Set(people.map((p) => p.organizationId).filter(Boolean))] as string[];
    const orgs = orgIds.length > 0
      ? await db
          .select({ id: schema.organizations.id, name: schema.organizations.name, domain: schema.organizations.domain })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, orgIds))
      : [];

    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const personMap = new Map(people.map((p) => [p.id, p]));

    const contactsForDrafting = enrollments.map((enrollment) => {
      const person = personMap.get(enrollment.personId);
      const org = person?.organizationId ? orgMap.get(person.organizationId) : null;
      return {
        enrollmentId: enrollment.id,
        personId: enrollment.personId,
        campaignPeopleId: enrollment.campaignPeopleId,
        name: person?.name ?? "Unknown",
        title: person?.title ?? null,
        email: person?.workEmail ?? person?.personalEmail ?? null,
        organizationId: person?.organizationId ?? null,
        company: org?.name ?? null,
        domain: org?.domain ?? null,
      };
    });

    return {
      sequenceId,
      sequenceName: sequence.name,
      campaignId: sequence.campaignId,
      steps: steps.map((s) => ({
        stepId: s.id,
        stepNumber: s.stepNumber,
        delayDays: s.delayDays,
        condition: s.condition,
      })),
      contacts: contactsForDrafting,
      totalDraftsNeeded: contactsForDrafting.length * steps.length,
      instructions:
        "Process contacts ONE AT A TIME. For each contact × step: " +
        "(1) call getContactDetail(personId) to fetch that contact's enrichment; " +
        "(2) optionally call getCompanyDetail(organizationId) if you need deep company context; " +
        "(3) call writeEmail with the personalized content, passing sequenceId, sequenceStepId, enrollmentId, and ai_reasoning; " +
        "(4) then move on to the next contact — do NOT preload enrichment for all contacts up front. " +
        "Step 1 is the initial cold email. Follow-ups reference the prior email and add urgency. The final step is a polite breakup. " +
        `After all drafts are created, tell the user to review them at /outreach/review?sequence=${sequenceId}`,
    };
  },
});

// ── draftEmailsForSequence ────────────────────────────────────────────────
// Server-side fan-out: drafts ALL emails in a sequence via parallel Claude
// sub-calls, then saves drafts to the DB.
export const draftEmailsForSequence = tool({
  description:
    "Draft ALL personalized emails for a sequence in parallel, server-side. " +
    "Loads each contact's enrichment, composes emails via a focused sub-agent " +
    "per contact × step, and saves drafts to the database. This is the " +
    "preferred way to draft sequence emails — the main agent does not need " +
    "to loop through contacts or call writeEmail itself. Use writeEmail only " +
    "for ad-hoc single-draft flows outside a sequence.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID to draft emails for."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(6)
      .describe("How many sub-agents to run in parallel. Default 6."),
  }),
  execute: async ({ sequenceId, concurrency }) => {
    const sdb = await getScopedDb();

    const [sequence] = await db
      .select({ id: schema.sequences.id, name: schema.sequences.name, campaignId: schema.sequences.campaignId })
      .from(schema.sequences)
      .where(eq(schema.sequences.id, sequenceId))
      .limit(1);
    if (!sequence) return { error: "Sequence not found." };

    const [campaign] = await db
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        icp: schema.campaigns.icp,
        offering: schema.campaigns.offering,
        positioning: schema.campaigns.positioning,
        profileId: schema.campaigns.profileId,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, sequence.campaignId))
      .limit(1);
    if (!campaign) return { error: "Campaign not found." };

    const userId = sdb.userId;

    let profile: { name: string | null; roleTitle: string | null; companyName: string | null; notes: string | null } | null = null;
    if (campaign.profileId) {
      const [p] = await db
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

    const steps = await db
      .select({ id: schema.sequenceSteps.id, stepNumber: schema.sequenceSteps.stepNumber, condition: schema.sequenceSteps.condition })
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, sequenceId))
      .orderBy(schema.sequenceSteps.stepNumber);
    if (!steps || steps.length === 0) {
      return { error: "No steps found for this sequence." };
    }

    const enrollments = await db
      .select({ id: schema.sequenceEnrollments.id, personId: schema.sequenceEnrollments.personId, campaignPeopleId: schema.sequenceEnrollments.campaignPeopleId })
      .from(schema.sequenceEnrollments)
      .where(eq(schema.sequenceEnrollments.sequenceId, sequenceId));
    if (!enrollments || enrollments.length === 0) {
      return { error: "No contacts enrolled in this sequence." };
    }

    const personIds = enrollments.map((e) => e.personId);
    const people = await db
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
      .where(inArray(schema.people.id, personIds));
    const personMap = new Map(people.map((p) => [p.id, p]));

    const orgIds = [...new Set(people.map((p) => p.organizationId).filter(Boolean))] as string[];
    const orgs = orgIds.length > 0
      ? await db
          .select({ id: schema.organizations.id, name: schema.organizations.name, domain: schema.organizations.domain, industry: schema.organizations.industry, enrichmentData: schema.organizations.enrichmentData })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, orgIds))
      : [];
    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    const activeSkills = await loadActiveEmailSkills({
      userId,
      profileId: campaign.profileId ?? null,
      campaignId: campaign.id,
    });

    type Task = {
      enrollmentId: string;
      personId: string;
      stepId: string;
      stepNumber: number;
      isFinal: boolean;
      condition: string;
      skipReason?: string;
    };
    const totalSteps = steps.length;
    const tasks: Task[] = [];
    for (const enrollment of enrollments) {
      const person = personMap.get(enrollment.personId);
      const hasEmail = person?.workEmail || person?.personalEmail;
      for (const step of steps) {
        tasks.push({
          enrollmentId: enrollment.id,
          personId: enrollment.personId,
          stepId: step.id,
          stepNumber: step.stepNumber,
          isFinal: step.stepNumber === totalSteps,
          condition: step.condition ?? "no_reply",
          skipReason: hasEmail ? undefined : "no email on contact",
        });
      }
    }

    // Fan out composition.
    const results = await mapConcurrent(tasks, concurrency, async (task) => {
      if (task.skipReason) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: true as const,
          reason: task.skipReason,
        };
      }

      const person = personMap.get(task.personId)!;
      const org = person.organizationId ? orgMap.get(person.organizationId) : null;

      const composed = await composeEmail({
        skills: activeSkills,
        contact: {
          name: person.name ?? null,
          title: person.title ?? null,
          email: person.workEmail ?? person.personalEmail ?? "",
          enrichmentData: (person.enrichmentData as Record<string, unknown> | null) ?? null,
        },
        company: org
          ? {
              name: org.name ?? null,
              domain: org.domain ?? null,
              industry: org.industry ?? null,
              enrichmentData: (org.enrichmentData as Record<string, unknown> | null) ?? null,
            }
          : null,
        step: {
          stepNumber: task.stepNumber,
          totalSteps,
          condition: task.condition,
          isFinal: task.isFinal,
        },
        campaign: {
          name: campaign.name,
          icp: (campaign.icp as Record<string, unknown> | null) ?? null,
          offering: (campaign.offering as Record<string, unknown> | null) ?? null,
          positioning: (campaign.positioning as Record<string, unknown> | null) ?? null,
        },
        senderProfile: {
          name: profile?.name ?? null,
          title: profile?.roleTitle ?? null,
          company: profile?.companyName ?? null,
          signature: profile?.notes ?? null,
        },
      });

      if (!composed.ok) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: false as const,
          error: composed.error,
        };
      }

      const saved = await saveDraft({
        userId,
        orgId: sdb.orgId,
        campaignId: campaign.id,
        personId: task.personId,
        subject: composed.email.subject,
        bodyHtml: composed.email.bodyHtml,
        bodyText: composed.email.bodyText,
        sequenceId,
        sequenceStepId: task.stepId,
        enrollmentId: task.enrollmentId,
        aiReasoning: composed.email.aiReasoning,
      });

      if (!saved.ok) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: false as const,
          error: saved.error,
        };
      }

      return {
        personId: task.personId,
        stepNumber: task.stepNumber,
        skipped: false as const,
        draftId: saved.draftId,
        subject: saved.subject,
      };
    });

    const drafted = results.filter((r) => !r.skipped && "draftId" in r).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.skipped && "error" in r);

    return {
      sequenceId,
      drafted,
      skipped,
      failed: failed.length,
      total: results.length,
      reviewUrl: `/outreach/review?sequence=${sequenceId}`,
      failures: failed.length > 0 ? failed : undefined,
      message: `Drafted ${drafted} of ${results.length} emails (${skipped} skipped, ${failed.length} failed). Tell the user to review at /outreach/review?sequence=${sequenceId}.`,
    };
  },
});

export const getSequenceStatus = tool({
  description:
    "Get the current status of a sequence including enrollment counts by status.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID."),
  }),
  execute: async ({ sequenceId }) => {
    const [sequence] = await db
      .select({
        id: schema.sequences.id,
        name: schema.sequences.name,
        status: schema.sequences.status,
        campaignId: schema.sequences.campaignId,
        triggerSignalId: schema.sequences.triggerSignalId,
        createdAt: schema.sequences.createdAt,
      })
      .from(schema.sequences)
      .where(eq(schema.sequences.id, sequenceId))
      .limit(1);

    if (!sequence) {
      return { error: "Sequence not found." };
    }

    const enrollments = await db
      .select({ status: schema.sequenceEnrollments.status })
      .from(schema.sequenceEnrollments)
      .where(eq(schema.sequenceEnrollments.sequenceId, sequenceId));

    const counts: Record<string, number> = {};
    for (const e of enrollments) {
      counts[e.status] = (counts[e.status] ?? 0) + 1;
    }

    const drafts = await db
      .select({ reviewStatus: schema.emailDrafts.reviewStatus })
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.sequenceId, sequenceId));

    const draftCounts: Record<string, number> = {};
    for (const d of drafts) {
      const status = d.reviewStatus ?? "pending";
      draftCounts[status] = (draftCounts[status] ?? 0) + 1;
    }

    return {
      sequence,
      enrollments: counts,
      totalEnrolled: enrollments.length,
      drafts: draftCounts,
      totalDrafts: drafts.length,
    };
  },
});
