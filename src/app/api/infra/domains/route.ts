import { getCurrentUser } from "@/lib/auth";
import { getEmailInfraProvider } from "@/lib/email-infra";

export const runtime = "nodejs";
export const maxDuration = 30;

/** List domains owned in the configured InboxKit workspace, with live health. */
export async function GET() {
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

  try {
    const domains = await provider.listDomains();
    return Response.json({ domains });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list domains" },
      { status: 502 },
    );
  }
}
