import "server-only";

import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Captures human-review actions on AI-drafted replies (edit/approve/reject)
 * as structured training signal. This is meant to later feed Port B's prompt
 * taxonomy — see SCHEMA NEEDS below for the follow-up this module is a
 * stopgap for.
 *
 * NO NEW TABLE: `emailDrafts` has no dedicated feedback/diff/rejection-reason
 * column yet (only `aiReasoning`, which already holds the AI's OWN reasoning
 * for the draft and shouldn't be overwritten — Port B needs both the
 * original reasoning AND the human correction to compare them). We append a
 * structured, timestamped note to `aiReasoning` as a working stopgap so the
 * signal isn't lost, but this should move to a dedicated column/table.
 *
 * SCHEMA NEEDS (report to coordinator, do not add ourselves):
 *   - emailDrafts.reviewFeedback jsonb  — structured {action, diffs, reason,
 *     recordedAt} history, one row of truth instead of parsing appended text.
 *   - emailDrafts.rejectionReason text  — free-text reason captured on reject.
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
 * Persists a feedback record by appending a structured note to
 * `emailDrafts.aiReasoning`. Best-effort: failures are logged, not thrown —
 * losing training signal must never block the approve/reject/edit action
 * itself.
 */
export async function recordFeedback(record: FeedbackRecord): Promise<void> {
  try {
    const [existing] = await adminDb
      .select({ aiReasoning: schema.emailDrafts.aiReasoning })
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.id, record.draftId))
      .limit(1);

    const note = JSON.stringify({
      type: "aisdr_review_feedback",
      action: record.action,
      reason: record.reason ?? null,
      diffs: record.diffs ?? [],
      recordedAt: new Date().toISOString(),
    });

    const nextReasoning = existing?.aiReasoning
      ? `${existing.aiReasoning}\n\n[FEEDBACK] ${note}`
      : `[FEEDBACK] ${note}`;

    await adminDb
      .update(schema.emailDrafts)
      .set({ aiReasoning: nextReasoning, updatedAt: new Date() })
      .where(eq(schema.emailDrafts.id, record.draftId));
  } catch (err) {
    console.error("[aisdr/feedback] failed to record feedback:", err);
  }
}
