import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { makeSmtpImapConnector } from "./smtp-imap";
import type { MailboxConnector, SmtpImapConfig, SmtpImapSecret } from "./types";

export type MailboxConnectionRow =
  typeof schema.mailboxConnections.$inferSelect;

export function encryptSecret(obj: unknown): string {
  return encryptApiKey(JSON.stringify(obj));
}
export function decryptSecret<T>(ciphertext: string): T {
  return JSON.parse(decryptApiKey(ciphertext)) as T;
}

/** Build a live connector from a stored connection row (decrypts secrets). */
export function getConnectorForRow(
  row: MailboxConnectionRow,
): MailboxConnector {
  if (row.type === "smtp_imap") {
    if (!row.secretEncrypted) {
      throw new Error("Mailbox connection has no stored credentials");
    }
    const secret = decryptSecret<SmtpImapSecret>(row.secretEncrypted);
    return makeSmtpImapConnector({
      fromAddress: row.fromAddress,
      fromName: row.fromName,
      config: row.config as unknown as SmtpImapConfig,
      secret,
    });
  }
  throw new Error(`Mailbox type not supported yet: ${row.type}`);
}

/** The user's active mailbox (default first, then most recent), or null. */
export async function getDefaultMailboxRow(
  clerkUserId: string,
): Promise<MailboxConnectionRow | null> {
  const rows = await adminDb
    .select()
    .from(schema.mailboxConnections)
    .where(
      and(
        eq(schema.mailboxConnections.clerkUserId, clerkUserId),
        eq(schema.mailboxConnections.status, "active"),
      ),
    )
    .orderBy(
      desc(schema.mailboxConnections.isDefault),
      desc(schema.mailboxConnections.createdAt),
    );
  return rows[0] ?? null;
}
