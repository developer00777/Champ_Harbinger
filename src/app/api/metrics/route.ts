import { NextResponse } from "next/server";
import { gte } from "drizzle-orm";

import { getRegistryForExport, spendUsdGauge } from "@/lib/monitoring/metrics";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Refresh the spend gauge from the trailing 24h of api_usage, grouped by service.
 * Best-effort: a DB hiccup must never break the metrics scrape.
 */
async function refreshSpendGauge(): Promise<void> {
  try {
    const since = new Date(Date.now() - 86_400_000);
    const rows = await adminDb
      .select({
        service: schema.apiUsage.service,
        cost: schema.apiUsage.estimatedCostUsd,
      })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, since));

    const byService = new Map<string, number>();
    for (const row of rows) {
      byService.set(
        row.service,
        (byService.get(row.service) ?? 0) + Number(row.cost),
      );
    }
    spendUsdGauge.reset();
    for (const [service, cost] of byService) {
      spendUsdGauge.labels(service).set(cost);
    }
  } catch (err) {
    console.error("[metrics] spend gauge refresh failed:", err);
  }
}

export async function GET() {
  await refreshSpendGauge();
  const registry = getRegistryForExport();
  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": registry.contentType,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
