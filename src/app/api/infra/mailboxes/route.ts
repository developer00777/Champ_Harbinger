import { getCurrentUser } from "@/lib/auth";
import { getEmailInfraProvider } from "@/lib/email-infra";

export const runtime = "nodejs";
export const maxDuration = 30;

/** List mailboxes in the InboxKit workspace, optionally filtered to one domain. */
export async function GET(request: Request) {
  try {
    await getCurrentUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = getEmailInfraProvider();
  if (!provider.enabled) {
    return Response.json(
      {
        error:
          "Email infrastructure is not configured (INBOXKIT_API_KEY missing).",
      },
      { status: 501 },
    );
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? undefined;

  try {
    const mailboxes = await provider.listMailboxes(domain);
    return Response.json({ mailboxes });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to list mailboxes",
      },
      { status: 502 },
    );
  }
}

/**
 * Buy additional mailboxes on an existing (already-owned) domain. Credentials
 * are not returned synchronously — InboxKit provisions asynchronously and
 * reports readiness via the status_change webhook
 * (/api/webhooks/inboxkit), which imports ready mailboxes into
 * mailbox_connections automatically.
 */
export async function POST(request: Request) {
  try {
    await getCurrentUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = getEmailInfraProvider();
  if (!provider.enabled) {
    return Response.json(
      {
        error:
          "Email infrastructure is not configured (INBOXKIT_API_KEY missing).",
      },
      { status: 501 },
    );
  }

  let body: { domain?: string; count?: number; usernames?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim();
  const count = Number(body.count ?? 0);
  if (!domain || !count || count < 1) {
    return Response.json(
      { error: "domain and a positive count are required" },
      { status: 400 },
    );
  }

  try {
    const mailboxes = await provider.buyMailboxes(
      domain,
      count,
      body.usernames,
    );
    return Response.json({ mailboxes });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to buy mailboxes" },
      { status: 502 },
    );
  }
}
