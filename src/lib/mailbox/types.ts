/**
 * MailboxConnector — one interface over every way a user can send/receive
 * outreach through their own mailbox. SMTP/IMAP today; Gmail + Outlook OAuth
 * slot in behind the same interface later. ChampMail remains a separate
 * high-volume sender (src/lib/email).
 */

export type MailboxType = "smtp_imap" | "gmail" | "outlook";

export interface MailboxSendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** RFC Message-ID this is replying to (threading). */
  inReplyTo?: string;
  references?: string;
}

export interface MailboxSendResult {
  messageId: string;
}

export interface InboundMessage {
  messageId?: string;
  inReplyTo?: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  receivedAt?: Date;
}

export interface MailboxConnector {
  readonly type: MailboxType;
  /** Check credentials/connectivity without sending. */
  verify(): Promise<{ ok: boolean; error?: string }>;
  send(input: MailboxSendInput): Promise<MailboxSendResult>;
  /** Fetch inbound messages newer than `since` (null = recent window). */
  fetchSince(since: Date | null, limit: number): Promise<InboundMessage[]>;
}

// Non-secret config persisted on the connection row.
export interface SmtpImapConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean; // true = implicit TLS (465); false = STARTTLS
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
}

// Secret persisted encrypted (secretEncrypted).
export interface SmtpImapSecret {
  user: string;
  pass: string;
}
