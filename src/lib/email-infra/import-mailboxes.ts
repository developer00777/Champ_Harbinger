import "server-only";
import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { encryptSecret } from "@/lib/mailbox/registry";
import type { SmtpImapConfig, SmtpImapSecret } from "@/lib/mailbox/types";
import type { MailboxCredentials } from "./types";

/**
 * Turn InboxKit-issued mailbox credentials into a `mailbox_connections` row
 * so the mailbox is immediately usable through the existing SMTP/IMAP
 * connector (src/lib/mailbox) — the same path a user's own connected mailbox
 * uses. Stamps `config.infraProvider = "inboxkit"` and `config.infraDomain`
 * so downstream guardrails (src/lib/sequencing/guardrails.ts) know this
 * mailbox's domain health must be verified against InboxKit before sending.
 */

export interface ImportMailboxInput {
  clerkUserId: string;
  domain: string;
  credentials: MailboxCredentials;
  label?: string;
  fromName?: string | null;
  makeDefault?: boolean;
}

export interface ImportMailboxResult {
  id: string;
  fromAddress: string;
}

/** Idempotent: re-importing the same email updates the existing row's secret instead of duplicating it. */
export async function importMailboxFromInboxKit(
  input: ImportMailboxInput,
): Promise<ImportMailboxResult> {
  const { clerkUserId, domain, credentials, label, fromName, makeDefault } =
    input;

  const config: SmtpImapConfig & {
    infraProvider: string;
    infraDomain: string;
  } = {
    smtpHost: credentials.smtpHost,
    smtpPort: credentials.smtpPort,
    smtpSecure: credentials.smtpSecure,
    imapHost: credentials.imapHost,
    imapPort: credentials.imapPort,
    imapSecure: credentials.imapSecure,
    infraProvider: "inboxkit",
    infraDomain: domain,
  };

  const secret: SmtpImapSecret = {
    user: credentials.username,
    pass: credentials.password,
  };

  const [existing] = await adminDb
    .select({ id: schema.mailboxConnections.id })
    .from(schema.mailboxConnections)
    .where(eq(schema.mailboxConnections.fromAddress, credentials.email))
    .limit(1);

  if (existing) {
    await adminDb
      .update(schema.mailboxConnections)
      .set({
        config: config as unknown as Record<string, unknown>,
        secretEncrypted: encryptSecret(secret),
        status: "active",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mailboxConnections.id, existing.id));
    return { id: existing.id, fromAddress: credentials.email };
  }

  if (makeDefault) {
    await adminDb
      .update(schema.mailboxConnections)
      .set({ isDefault: false })
      .where(eq(schema.mailboxConnections.clerkUserId, clerkUserId));
  }

  const [row] = await adminDb
    .insert(schema.mailboxConnections)
    .values({
      clerkUserId,
      type: "smtp_imap",
      label: label ?? domain,
      fromAddress: credentials.email,
      fromName: fromName ?? null,
      config: config as unknown as Record<string, unknown>,
      secretEncrypted: encryptSecret(secret),
      status: "active",
      isDefault: Boolean(makeDefault),
    })
    .returning({ id: schema.mailboxConnections.id });

  if (!row) throw new Error("Failed to import InboxKit mailbox");
  return { id: row.id, fromAddress: credentials.email };
}

/** Import every ready mailbox from an InboxKit order in one call. */
export async function importMailboxesFromOrder(input: {
  clerkUserId: string;
  domain: string;
  mailboxes: MailboxCredentials[];
  fromName?: string | null;
}): Promise<ImportMailboxResult[]> {
  const results: ImportMailboxResult[] = [];
  for (const credentials of input.mailboxes) {
    results.push(
      await importMailboxFromInboxKit({
        clerkUserId: input.clerkUserId,
        domain: input.domain,
        credentials,
        fromName: input.fromName,
        makeDefault: false,
      }),
    );
  }
  return results;
}
