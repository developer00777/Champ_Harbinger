import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import {
  makeSmtpImapConnector,
  SMTP_IMAP_PRESETS,
} from "@/lib/mailbox/smtp-imap";
import { encryptSecret } from "@/lib/mailbox/registry";
import type { SmtpImapConfig } from "@/lib/mailbox/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/** List the signed-in user's mailbox connections (no secrets). */
export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await adminDb
    .select({
      id: schema.mailboxConnections.id,
      type: schema.mailboxConnections.type,
      label: schema.mailboxConnections.label,
      fromAddress: schema.mailboxConnections.fromAddress,
      fromName: schema.mailboxConnections.fromName,
      status: schema.mailboxConnections.status,
      isDefault: schema.mailboxConnections.isDefault,
      lastError: schema.mailboxConnections.lastError,
      lastSyncedAt: schema.mailboxConnections.lastSyncedAt,
      createdAt: schema.mailboxConnections.createdAt,
    })
    .from(schema.mailboxConnections)
    .where(eq(schema.mailboxConnections.clerkUserId, userId))
    .orderBy(
      desc(schema.mailboxConnections.isDefault),
      desc(schema.mailboxConnections.createdAt),
    );
  return Response.json({ connections: rows });
}

/** Connect a new SMTP/IMAP mailbox. Verifies credentials before saving. */
export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fromAddress = String(body.fromAddress ?? "").trim();
  const password = String(body.password ?? "");
  if (!fromAddress || !password) {
    return Response.json(
      { error: "fromAddress and password are required" },
      { status: 400 },
    );
  }
  const user = String(body.user ?? fromAddress).trim();
  const preset = typeof body.preset === "string" ? body.preset : undefined;
  const presetCfg = preset ? SMTP_IMAP_PRESETS[preset] : undefined;

  const config: SmtpImapConfig = presetCfg ?? {
    smtpHost: String(body.smtpHost ?? ""),
    smtpPort: Number(body.smtpPort ?? 465),
    smtpSecure: body.smtpSecure !== false,
    imapHost: String(body.imapHost ?? ""),
    imapPort: Number(body.imapPort ?? 993),
    imapSecure: body.imapSecure !== false,
  };
  if (!config.smtpHost || !config.imapHost) {
    return Response.json(
      { error: "SMTP and IMAP hosts are required (or pick a preset)" },
      { status: 400 },
    );
  }

  const fromName = body.fromName ? String(body.fromName) : null;
  const connector = makeSmtpImapConnector({
    fromAddress,
    fromName,
    config,
    secret: { user, pass: password },
  });
  const check = await connector.verify();
  if (!check.ok) {
    return Response.json(
      { error: `Could not connect: ${check.error ?? "verification failed"}` },
      { status: 422 },
    );
  }

  const makeDefault = body.makeDefault !== false;
  if (makeDefault) {
    await adminDb
      .update(schema.mailboxConnections)
      .set({ isDefault: false })
      .where(eq(schema.mailboxConnections.clerkUserId, userId));
  }

  const [row] = await adminDb
    .insert(schema.mailboxConnections)
    .values({
      clerkUserId: userId,
      type: "smtp_imap",
      label: preset ?? config.smtpHost,
      fromAddress,
      fromName,
      config: config as unknown as Record<string, unknown>,
      secretEncrypted: encryptSecret({ user, pass: password }),
      status: "active",
      isDefault: makeDefault,
    })
    .returning({ id: schema.mailboxConnections.id });

  return Response.json({ ok: true, id: row.id });
}
