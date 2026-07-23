import "server-only";

import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Captures human-review actions on AI-drafted replies (edit/approve/reject)
 * as structured training signal, meant to later feed Port B's prompt
 * taxonomy. Persisted to `emailDrafts.reviewFeedback` (structured history)
 * and `emailDrafts.rejectionReason` (latest reject reason) — `aiReasoning`
 * is left untouched since it holds the AI's own reasoning for the draft.
 */

export type FeedbackAction = "approved" | "edited" | "rejected";

export interface FieldDiff {
  field: "subject" | "bodyHtml" | "bodyText";
  before: string;
  after: string;
}

export interface FeedbackRecord {
  draftId: string;
  action: FeedbackAction;
  diffs?: FieldDiff[];
  reason?: string | null;
}

export interface DraftSnapshot {
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
}

/**
 * Computes the set of changed fields between the original draft and an
 * edited version. Only fields that actually changed are included.
 */
export function computeDiff(
  original: DraftSnapshot,
  edited: Partial<DraftSnapshot>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (edited.subject !== undefined && edited.subject !== original.subject) {
    diffs.push({
      field: "subject",
      before: original.subject,
      after: edited.subject,
    });
  }
  if (edited.bodyHtml !== undefined && edited.bodyHtml !== original.bodyHtml) {
    diffs.push({
      field: "bodyHtml",
      before: original.bodyHtml,
      after: edited.bodyHtml,
    });
  }
  if (
    edited.bodyText !== undefined &&
    (edited.bodyText ?? "") !== (original.bodyText ?? "")
  ) {
    diffs.push({
      field: "bodyText",
      before: original.bodyText ?? "",
      after: edited.bodyText ?? "",
    });
  }

  return diffs;
}

/**
 * Persists a feedback record onto `emailDrafts.reviewFeedback` (append) and
 * `emailDrafts.rejectionReason` (latest reason, when rejecting). Best-effort:
 * failures are logged, not thrown — losing training signal must never block
 * the approve/reject/edit action itself.
 */
export async function recordFeedback(record: FeedbackRecord): Promise<void> {
  try {
    const [existing] = await adminDb
      .select({ reviewFeedback: schema.emailDrafts.reviewFeedback })
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.id, record.draftId))
      .limit(1);

    const entry = {
      action: record.action,
      reason: record.reason ?? null,
      diffs: record.diffs ?? [],
      recordedAt: new Date().toISOString(),
    };

    const nextFeedback = [...(existing?.reviewFeedback ?? []), entry];

    await adminDb
      .update(schema.emailDrafts)
      .set({
        reviewFeedback: nextFeedback,
        ...(record.action === "rejected"
          ? { rejectionReason: record.reason ?? null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.emailDrafts.id, record.draftId));
  } catch (err) {
    console.error("[aisdr/feedback] failed to record feedback:", err);
  }
}
