import { and, eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getConnectorForRow } from "@/lib/mailbox/registry";

/** Strip RFC angle brackets so In-Reply-To matches a stored Message-ID. */
function normalizeId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.replace(/^<|>$/g, "").trim() || null;
}

/**
 * Poll every active mailbox for new inbound messages, store them, and stamp any
 * matching sent_emails row as replied (matched via In-Reply-To → our Message-ID).
 * Runs in the worker process (IMAP needs Node).
 */
export async function syncMailboxes(): Promise<{
  synced: number;
  replies: number;
}> {
  const conns = await adminDb
    .select()
    .from(schema.mailboxConnections)
    .where(eq(schema.mailboxConnections.status, "active"));

  let synced = 0;
  let replies = 0;

  for (const conn of conns) {
    if (conn.type !== "smtp_imap") continue; // OAuth connectors land later
    try {
      const connector = getConnectorForRow(conn);
      const msgs = await connector.fetchSince(conn.lastSyncedAt, 50);

      for (const m of msgs) {
        const msgId = normalizeId(m.messageId);
        if (!msgId) continue;

        const [existing] = await adminDb
          .select({ id: schema.mailboxMessages.id })
          .from(schema.mailboxMessages)
          .where(
            and(
              eq(schema.mailboxMessages.connectionId, conn.id),
              eq(schema.mailboxMessages.messageId, msgId),
            ),
          )
          .limit(1);
        if (existing) continue;

        // Match a reply to one of our sent emails.
        let sentEmailId: string | null = null;
        const inReplyTo = normalizeId(m.inReplyTo);
        if (inReplyTo) {
          const [sent] = await adminDb
            .select({ id: schema.sentEmails.id })
            .from(schema.sentEmails)
            .where(eq(schema.sentEmails.agentmailMessageId, inReplyTo))
            .limit(1);
          if (sent) {
            sentEmailId = sent.id;
            await adminDb
              .update(schema.sentEmails)
              .set({ repliedAt: m.receivedAt ?? new Date(), status: "replied" })
              .where(eq(schema.sentEmails.id, sent.id));
            replies++;
          }
        }

        await adminDb.insert(schema.mailboxMessages).values({
          connectionId: conn.id,
          clerkUserId: conn.clerkUserId,
          messageId: msgId,
          inReplyTo,
          fromAddress: m.from ?? null,
          toAddress: m.to ?? null,
          subject: m.subject ?? null,
          snippet: m.snippet ?? null,
          body: m.body ?? null,
          sentEmailId,
          receivedAt: m.receivedAt ?? null,
        });
        synced++;
      }

      await adminDb
        .update(schema.mailboxConnections)
        .set({ lastSyncedAt: new Date(), lastError: null })
        .where(eq(schema.mailboxConnections.id, conn.id));
    } catch (err) {
      await adminDb
        .update(schema.mailboxConnections)
        .set({
          lastError: err instanceof Error ? err.message : "sync failed",
          status: "error",
        })
        .where(eq(schema.mailboxConnections.id, conn.id));
    }
  }

  return { synced, replies };
}
