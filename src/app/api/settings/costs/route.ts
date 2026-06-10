import { fetchOpenRouterCredits } from "@/lib/services/real-spend";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";

export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30d";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)),
  );

  // Calculate date cutoff
  let since: Date | null = null;
  if (period === "24h") {
    since = new Date(Date.now() - 86400000);
  } else if (period === "7d") {
    since = new Date(Date.now() - 7 * 86400000);
  } else if (period === "30d") {
    since = new Date(Date.now() - 30 * 86400000);
  }

  // Build the base where condition
  const baseWhere = since
    ? and(
        eq(schema.apiUsage.clerkUserId, userId),
        gte(schema.apiUsage.createdAt, since),
      )
    : eq(schema.apiUsage.clerkUserId, userId);

  const [
    totalRows,
    byServiceRows,
    byOperationRows,
    dailyRows,
    recentResult,
    credits,
  ] = await Promise.all([
    // Total cost
    adminDb
      .select({ cost: schema.apiUsage.estimatedCostUsd })
      .from(schema.apiUsage)
      .where(baseWhere),

    // By service (metadata.costSource tells us whether the cost is OpenRouter-real
    // or a local estimate, so the UI can badge partially-estimated services)
    adminDb
      .select({
        service: schema.apiUsage.service,
        cost: schema.apiUsage.estimatedCostUsd,
        metadata: schema.apiUsage.metadata,
      })
      .from(schema.apiUsage)
      .where(baseWhere),

    // By operation
    adminDb
      .select({
        service: schema.apiUsage.service,
        operation: schema.apiUsage.operation,
        cost: schema.apiUsage.estimatedCostUsd,
        tokensInput: schema.apiUsage.tokensInput,
        tokensOutput: schema.apiUsage.tokensOutput,
      })
      .from(schema.apiUsage)
      .where(baseWhere),

    // Daily time-series
    adminDb
      .select({
        date: sql<string>`date_trunc('day', ${schema.apiUsage.createdAt})::date::text`,
        service: schema.apiUsage.service,
        cost: schema.apiUsage.estimatedCostUsd,
      })
      .from(schema.apiUsage)
      .where(baseWhere)
      .orderBy(schema.apiUsage.createdAt),

    // Recent rows (paginated) — use a count subquery approach
    Promise.all([
      adminDb
        .select()
        .from(schema.apiUsage)
        .where(baseWhere)
        .orderBy(desc(schema.apiUsage.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      adminDb.select({ total: count() }).from(schema.apiUsage).where(baseWhere),
    ]),

    fetchOpenRouterCredits(),
  ]);

  const [recentRows, [{ total: recentTotal }]] = recentResult;

  // Aggregate total cost
  const totalCost = totalRows.reduce((sum, r) => sum + Number(r.cost), 0);

  // Aggregate by service. `estimatedCost` is the portion of a service's spend
  // that came from local token estimates rather than OpenRouter's real billed
  // cost (metadata.costSource), so the UI can badge partially-estimated rows.
  const serviceMap = new Map<
    string,
    {
      cost: number;
      estimatedCost: number;
      calls: number;
      tokens_input: number;
      tokens_output: number;
    }
  >();
  for (const row of byServiceRows) {
    const prev = serviceMap.get(row.service) ?? {
      cost: 0,
      estimatedCost: 0,
      calls: 0,
      tokens_input: 0,
      tokens_output: 0,
    };
    const cost = Number(row.cost);
    prev.cost += cost;
    if (
      (row.metadata as Record<string, unknown> | null)?.costSource !==
      "openrouter"
    ) {
      prev.estimatedCost += cost;
    }
    prev.calls++;
    serviceMap.set(row.service, prev);
  }

  // Aggregate by operation
  const opMap = new Map<
    string,
    { cost: number; calls: number; tokens_input: number; tokens_output: number }
  >();
  for (const row of byOperationRows) {
    const key = `${row.service}/${row.operation}`;
    const prev = opMap.get(key) ?? {
      cost: 0,
      calls: 0,
      tokens_input: 0,
      tokens_output: 0,
    };
    prev.cost += Number(row.cost);
    prev.calls++;
    prev.tokens_input += row.tokensInput ?? 0;
    prev.tokens_output += row.tokensOutput ?? 0;
    opMap.set(key, prev);
  }

  // Merge token totals into serviceMap
  for (const [key, op] of opMap) {
    const service = key.split("/")[0];
    const svc = serviceMap.get(service);
    if (svc) {
      svc.tokens_input += op.tokens_input;
      svc.tokens_output += op.tokens_output;
    }
  }

  // Daily time series (already grouped by day from DB)
  const dayMap = new Map<string, Record<string, number>>();
  for (const row of dailyRows) {
    const day = row.date;
    if (!dayMap.has(day)) dayMap.set(day, {});
    const bucket = dayMap.get(day)!;
    bucket[row.service] = (bucket[row.service] ?? 0) + Number(row.cost);
    bucket.total = (bucket.total ?? 0) + Number(row.cost);
  }
  const daily = Array.from(dayMap.entries())
    .map(([date, costs]) => ({ date, ...costs }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build response
  const byService = Array.from(serviceMap.entries())
    .map(([service, stats]) => ({ service, ...stats }))
    .sort((a, b) => b.cost - a.cost);

  const byOperation = Array.from(opMap.entries())
    .map(([key, stats]) => {
      const [service, operation] = key.split("/");
      return { service, operation, ...stats };
    })
    .sort((a, b) => b.cost - a.cost);

  return Response.json({
    period,
    totalCost,
    byService,
    byOperation,
    daily,
    credits,
    recent: recentRows,
    recentPagination: {
      page,
      pageSize,
      totalRows: recentTotal,
      totalPages: Math.ceil(recentTotal / pageSize),
    },
  });
}
