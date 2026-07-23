import "server-only";

import { and, eq, isNull, isNotNull } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { handleInboundMessage, type HandleInboundResult } from "./respond";

export interface ProcessPendingRepliesResult {
  processed: number;
  results: HandleInboundResult[];
}

/**
 * Batch driver: finds inbound mailbox messages that link to a sent email
 * whose `repliedAt` hasn't been stamped yet (i.e. not yet processed by
 * handleInboundMessage), and runs each one through the halt → classify →
 * route pipeline.
 *
 * Plain function, no pg-boss/job registration here — the coordinator wires
 * scheduling in src/lib/jobs/**.
 */
export async function processPendingReplies(
  limit = 50,
): Promise<ProcessPendingRepliesResult> {
  const rows = await adminDb
    .select({ id: schema.mailboxMessages.id })
    .from(schema.mailboxMessages)
    .innerJoin(
      schema.sentEmails,
      eq(schema.mailboxMessages.sentEmailId, schema.sentEmails.id),
    )
    .where(
      and(
        isNotNull(schema.mailboxMessages.sentEmailId),
        isNull(schema.sentEmails.repliedAt),
      ),
    )
    .limit(limit);

  const results: HandleInboundResult[] = [];
  for (const row of rows) {
    try {
      const result = await handleInboundMessage(row.id);
      results.push(result);
    } catch (err) {
      // handleInboundMessage's own halt step already ran before anything
      // that could throw here in practice, but keep the batch resilient to
      // a single bad message regardless.
      console.error(
        `[aisdr/process] failed to process mailboxMessage ${row.id}:`,
        err,
      );
      results.push({
        ok: false,
        mailboxMessageId: row.id,
        error: err instanceof Error ? err.message : "processing failed",
      });
    }
  }

  return { processed: results.length, results };
}
