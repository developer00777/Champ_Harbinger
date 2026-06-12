import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

import type {
  MailboxConnector,
  MailboxSendInput,
  MailboxSendResult,
  InboundMessage,
  SmtpImapConfig,
  SmtpImapSecret,
} from "./types";

/** Well-known SMTP/IMAP presets so users only type an email + app password. */
export const SMTP_IMAP_PRESETS: Record<string, Omit<SmtpImapConfig, never>> = {
  gmail: {
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
  },
  outlook: {
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
  },
};

interface Opts {
  fromAddress: string;
  fromName?: string | null;
  config: SmtpImapConfig;
  secret: SmtpImapSecret;
}

export function makeSmtpImapConnector(opts: Opts): MailboxConnector {
  const { fromAddress, fromName, config, secret } = opts;

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: secret.user, pass: secret.pass },
  });

  async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: secret.user, pass: secret.pass },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  return {
    type: "smtp_imap",

    async verify() {
      try {
        await transporter.verify();
        await withImap(async () => {});
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "verify failed",
        };
      }
    },

    async send(input: MailboxSendInput): Promise<MailboxSendResult> {
      const info = await transporter.sendMail({
        from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      return { messageId: info.messageId };
    },

    async fetchSince(
      since: Date | null,
      limit: number,
    ): Promise<InboundMessage[]> {
      const sinceDate = since ?? new Date(Date.now() - 7 * 86_400_000);
      return withImap(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        const out: InboundMessage[] = [];
        try {
          for await (const msg of client.fetch(
            { since: sinceDate },
            { envelope: true, source: true },
          )) {
            const env = msg.envelope;
            const raw = msg.source?.toString("utf8") ?? "";
            // Lightweight body extraction: strip headers, take the text part.
            const bodyStart = raw.indexOf("\r\n\r\n");
            const body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
            out.push({
              messageId: env?.messageId ?? undefined,
              inReplyTo: env?.inReplyTo ?? undefined,
              from: env?.from?.[0]?.address ?? undefined,
              to: env?.to?.[0]?.address ?? undefined,
              subject: env?.subject ?? undefined,
              snippet: body.replace(/\s+/g, " ").trim().slice(0, 280),
              body: body.slice(0, 20_000),
              receivedAt: env?.date ?? undefined,
            });
            if (out.length >= limit) break;
          }
        } finally {
          lock.release();
        }
        return out;
      });
    },
  };
}
