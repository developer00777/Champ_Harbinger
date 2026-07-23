import { getCurrentUser } from "@/lib/auth";
import { getEmailInfraProvider } from "@/lib/email-infra";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Search for registerable domains via the configured email-infra provider (InboxKit). */
export async function GET(request: Request) {
  try {
    await getCurrentUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json(
      { error: "q query param is required" },
      { status: 400 },
    );
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
    const results = await provider.searchDomains(q);
    return Response.json({ results });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Domain search failed" },
      { status: 502 },
    );
  }
}
