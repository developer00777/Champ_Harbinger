import { getCurrentUser } from "@/lib/auth";
import { fetchResults } from "@/lib/enrichment/results-query";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrich/results?campaignId=&minCompleteness=
 *
 * The persisted waterfall results for the Results screen (spec §9 screen 4):
 * user-scoped enriched contacts with completeness/confidence/status and the
 * per-field provenance. Optional campaign + minimum-completeness filters.
 */
export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const campaignId = params.get("campaignId");
  const minRaw = params.get("minCompleteness");
  const minCompleteness =
    minRaw != null && minRaw !== "" ? Number(minRaw) : null;

  const results = await fetchResults({
    clerkUserId: userId,
    campaignId,
    minCompleteness:
      minCompleteness != null && Number.isFinite(minCompleteness)
        ? minCompleteness
        : null,
  });

  return Response.json({ results });
}
