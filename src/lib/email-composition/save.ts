import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";

export type SaveDraftInput = {
  userId: string;
  orgId?: string | null;
  campaignId: string;
  personId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  sequenceId?: string | null;
  sequenceStepId?: string | null;
  enrollmentId?: string | null;
  aiReasoning?: string | null;
};

export type SaveDraftResult =
  | {
      ok: true;
      draftId: string;
      to: string;
      subject: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Inserts an email_drafts row. Shared by writeEmail (ad-hoc) and
 * draftEmailsForSequence (fan-out). Returns a discriminated union so
 * callers decide how to surface errors.
 *
 * Accepts an optional first `_unused` argument for backwards compatibility
 * with callers that used to pass a SupabaseClient as the first argument.
 */
export async function saveDraft(
  _unused: unknown,
  input: SaveDraftInput,
): Promise<SaveDraftResult>;
export async function saveDraft(
  input: SaveDraftInput,
): Promise<SaveDraftResult>;
export async function saveDraft(
  firstArg: unknown,
  secondArg?: SaveDraftInput,
): Promise<SaveDraftResult> {
  const input: SaveDraftInput = secondArg ?? (firstArg as SaveDraftInput);

  const [person] = await db
    .select({
      id: schema.people.id,
      workEmail: schema.people.workEmail,
      personalEmail: schema.people.personalEmail,
    })
    .from(schema.people)
    .where(eq(schema.people.id, input.personId))
    .limit(1);

  if (!person) {
    return { ok: false, error: "Person not found." };
  }

  const toEmail = person.workEmail ?? person.personalEmail;
  if (!toEmail) {
    return {
      ok: false,
      error:
        "No email address on this contact. Use findEmail to discover one first.",
    };
  }

  const [cp] = await db
    .select({ id: schema.campaignPeople.id })
    .from(schema.campaignPeople)
    .where(
      and(
        eq(schema.campaignPeople.campaignId, input.campaignId),
        eq(schema.campaignPeople.personId, input.personId),
      ),
    )
    .limit(1);

  if (!cp) {
    return {
      ok: false,
      error: "Person is not linked to the specified campaign.",
    };
  }

  try {
    const [draft] = await db
      .insert(schema.emailDrafts)
      .values({
        clerkUserId: input.userId,
        clerkOrgId: input.orgId ?? null,
        campaignId: input.campaignId,
        personId: input.personId,
        campaignPeopleId: cp.id,
        toEmail,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText ?? null,
        status: "draft",
        sequenceId: input.sequenceId ?? null,
        sequenceStepId: input.sequenceStepId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        aiReasoning: input.aiReasoning ?? null,
        reviewStatus: input.sequenceId ? "pending" : "approved",
      })
      .returning({
        id: schema.emailDrafts.id,
        toEmail: schema.emailDrafts.toEmail,
        subject: schema.emailDrafts.subject,
      });

    if (!draft) {
      return { ok: false, error: "Failed to save draft: no rows returned" };
    }

    return {
      ok: true,
      draftId: draft.id,
      to: draft.toEmail,
      subject: draft.subject,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to save draft: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
