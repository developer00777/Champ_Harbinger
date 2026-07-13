import { getCurrentUser } from "@/lib/auth";
import { buildProvenanceCsv } from "@/lib/enrichment/results-export";
import { fetchResults } from "@/lib/enrichment/results-query";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrich/export?campaignId=&minCompleteness=
 *
 * Provenance-attached CSV of the enriched contacts (spec §9 screen 4). Same
 * filters as the results list. Every field ships with source/confidence/verified
 * so the export is auditable.
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

  const rows = await fetchResults({
    clerkUserId: userId,
    campaignId,
    minCompleteness:
      minCompleteness != null && Number.isFinite(minCompleteness)
        ? minCompleteness
        : null,
  });

  const csv = buildProvenanceCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="harbinger-enrichment-${stamp}.csv"`,
    },
  });
}
