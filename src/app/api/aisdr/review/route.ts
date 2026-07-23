import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { computeDiff, recordFeedback } from "@/lib/aisdr/feedback";
import { sendApprovedReplyDraft } from "@/lib/aisdr/respond";

export const dynamic = "force-dynamic";

/**
 * GET /api/aisdr/review
 *
 * Returns every pending `emailDrafts` row for the signed-in user — the human
 * review queue. This is deliberately NOT scoped to a single sequence (unlike
 * /api/outreach/drafts): AISDR reply drafts have no sequenceId, so a
 * sequence-scoped query would never surface them.
 */
export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      sequenceId: schema.emailDrafts.sequenceId,
      sequenceStepId: schema.emailDrafts.sequenceStepId,
      enrollmentId: schema.emailDrafts.enrollmentId,
      personId: schema.emailDrafts.personId,
      campaignId: schema.emailDrafts.campaignId,
      createdAt: schema.emailDrafts.createdAt,
    })
    .from(schema.emailDrafts)
    .where(
      and(
        eq(schema.emailDrafts.reviewStatus, "pending"),
        eq(schema.emailDrafts.clerkUserId, userId),
      ),
    )
    .orderBy(desc(schema.emailDrafts.createdAt));

  if (draftRows.length === 0) {
    return NextResponse.json({ drafts: [] });
  }

  const personIds = [...new Set(draftRows.map((d) => d.personId))];
  const campaignIds = [...new Set(draftRows.map((d) => d.campaignId))];

  const [people, campaignsList] = await Promise.all([
    personIds.length > 0
      ? adminDb
          .select({
            id: schema.people.id,
            name: schema.people.name,
            title: schema.people.title,
            organizationId: schema.people.organizationId,
          })
          .from(schema.people)
          .where(inArray(schema.people.id, personIds))
      : Promise.resolve([]),
    campaignIds.length > 0
      ? adminDb
          .select({ id: schema.campaigns.id, name: schema.campaigns.name })
          .from(schema.campaigns)
          .where(inArray(schema.campaigns.id, campaignIds))
      : Promise.resolve([]),
  ]);

  const personById = new Map(people.map((p) => [p.id, p]));
  const campaignById = new Map(campaignsList.map((c) => [c.id, c]));

  const drafts = draftRows.map((d) => {
    const person = personById.get(d.personId);
    const campaign = campaignById.get(d.campaignId);
    return {
      id: d.id,
      to_email: d.toEmail,
      subject: d.subject,
      body_html: d.bodyHtml,
      body_text: d.bodyText,
      ai_reasoning: d.aiReasoning,
      review_status: d.reviewStatus,
      status: d.status,
      is_reply_draft: !d.sequenceId,
      sequence_id: d.sequenceId,
      enrollment_id: d.enrollmentId,
      person_id: d.personId,
      person_name: person?.name ?? "Unknown",
      person_title: person?.title ?? null,
      campaign_id: d.campaignId,
      campaign_name: campaign?.name ?? "Unknown",
      created_at: d.createdAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ drafts });
}

interface PatchAction {
  id: string;
  action: "approve" | "reject";
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  reason?: string;
}

/**
 * PATCH /api/aisdr/review
 *
 * Body: { updates: PatchAction[] }
 *
 * - approve: optionally persists an edit first (subject/bodyHtml/bodyText),
 *   records the diff from the original as feedback, flips reviewStatus to
 *   "approved", then hands off to a send path: sequence-step drafts should
 *   go through the existing /api/outreach/send-now flow (left to the caller
 *   — this route reports back that it needs that path); AISDR reply drafts
 *   (no sequenceStepId) are sent directly via sendApprovedReplyDraft.
 * - reject: records the reason as feedback and flips reviewStatus to
 *   "rejected". Persists what changed (nothing to send).
 */
export async function PATCH(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { updates?: PatchAction[] };
  const updates = body.updates ?? [];
  if (updates.length === 0) {
    return NextResponse.json({ error: "updates is required" }, { status: 400 });
  }

  const results = await Promise.all(
    updates.map(async (u) => {
      const [draft] = await adminDb
        .select()
        .from(schema.emailDrafts)
        .where(
          and(
            eq(schema.emailDrafts.id, u.id),
            eq(schema.emailDrafts.clerkUserId, userId),
          ),
        )
        .limit(1);

      if (!draft) {
        return { id: u.id, ok: false, error: "Draft not found" };
      }

      const now = new Date();

      if (u.action === "reject") {
        await adminDb
          .update(schema.emailDrafts)
          .set({ reviewStatus: "rejected", updatedAt: now })
          .where(eq(schema.emailDrafts.id, u.id));
        await recordFeedback({
          draftId: u.id,
          action: "rejected",
          reason: u.reason ?? null,
        });
        return { id: u.id, ok: true, reviewStatus: "rejected" };
      }

      // approve (with optional edits first)
      const edited = {
        subject: u.subject,
        bodyHtml: u.bodyHtml,
        bodyText: u.bodyText,
      };
      const diffs = computeDiff(
        {
          subject: draft.subject,
          bodyHtml: draft.bodyHtml,
          bodyText: draft.bodyText,
        },
        edited,
      );

      const patch: Record<string, unknown> = {
        reviewStatus: "approved",
        updatedAt: now,
      };
      if (u.subject !== undefined) patch.subject = u.subject;
      if (u.bodyHtml !== undefined) patch.bodyHtml = u.bodyHtml;
      if (u.bodyText !== undefined) patch.bodyText = u.bodyText;

      await adminDb
        .update(schema.emailDrafts)
        .set(patch)
        .where(eq(schema.emailDrafts.id, u.id));

      await recordFeedback({
        draftId: u.id,
        action: diffs.length > 0 ? "edited" : "approved",
        diffs,
      });

      if (draft.sequenceStepId) {
        // Sequence-cadence draft — the send-now path
        // (src/app/api/outreach/send-now/route.ts) owns dispatching these.
        return {
          id: u.id,
          ok: true,
          reviewStatus: "approved",
          needsSequenceSend: true,
        };
      }

      const sendResult = await sendApprovedReplyDraft(u.id);
      return {
        id: u.id,
        ok: sendResult.ok,
        reviewStatus: "approved",
        sendError: sendResult.ok ? undefined : sendResult.error,
      };
    }),
  );

  return NextResponse.json({ results });
}
