import { desc, gte, sql } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { requireSuperAdminApi } from "@/lib/admin/guard";
import { currentDayStartUtc, currentWeekStartUtc } from "@/lib/budget/spend";
import {
  effectiveUserDailyLimitUsd,
  effectiveUserWeeklyLimitUsd,
} from "@/lib/teams";

export const dynamic = "force-dynamic";

export interface AnalyticsDailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  costUsd: number;
  calls: number;
}

export interface AnalyticsUserRow {
  clerkUserId: string;
  email: string | null;
  teamName: string | null;
  spend30dUsd: number;
  calls30d: number;
  weekSpendUsd: number;
  daySpendUsd: number;
  weeklyLimitUsd: number | null;
  dailyLimitUsd: number | null;
  weekPctUsed: number | null; // 0..N fraction; null when unlimited
  dayPctUsed: number | null;
  memberId: string | null; // team_members.id for inline limit adjustment
  teamId: string | null;
  perUserWeeklyLimitUsd: number | null; // raw member override (edit target)
  perUserDailyLimitUsd: number | null;
}

export interface AnalyticsPayload {
  dailySeries: AnalyticsDailyPoint[];
  byUser: AnalyticsUserRow[];
  byService: Array<{ service: string; costUsd: number; calls: number }>;
  byOperation: Array<{
    service: string;
    operation: string;
    costUsd: number;
    calls: number;
  }>;
  windowStartIso: string;
  weekStartIso: string;
  dayStartIso: string;
}

const COST = sql<string>`coalesce(sum(${schema.apiUsage.estimatedCostUsd}), 0)::text`;
const CALLS = sql<number>`count(*)::int`;

function pct(spend: number, limit: number | null): number | null {
  return limit != null && limit > 0 ? spend / limit : null;
}

export async function GET() {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;

  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const weekStart = currentWeekStartUtc(now);
  const dayStart = currentDayStartUtc(now);

  const day = sql<string>`to_char(date_trunc('day', ${schema.apiUsage.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [
    daily,
    users30d,
    usersWeek,
    usersDay,
    services,
    operations,
    memberRows,
    teamRows,
  ] = await Promise.all([
    adminDb
      .select({ date: day, costUsd: COST, calls: CALLS })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, windowStart))
      .groupBy(day)
      .orderBy(day),
    adminDb
      .select({
        clerkUserId: schema.apiUsage.clerkUserId,
        costUsd: COST,
        calls: CALLS,
      })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, windowStart))
      .groupBy(schema.apiUsage.clerkUserId)
      .orderBy(desc(sql`sum(${schema.apiUsage.estimatedCostUsd})`))
      .limit(25),
    adminDb
      .select({ clerkUserId: schema.apiUsage.clerkUserId, costUsd: COST })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, weekStart))
      .groupBy(schema.apiUsage.clerkUserId),
    adminDb
      .select({ clerkUserId: schema.apiUsage.clerkUserId, costUsd: COST })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, dayStart))
      .groupBy(schema.apiUsage.clerkUserId),
    adminDb
      .select({ service: schema.apiUsage.service, costUsd: COST, calls: CALLS })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, windowStart))
      .groupBy(schema.apiUsage.service)
      .orderBy(desc(sql`sum(${schema.apiUsage.estimatedCostUsd})`)),
    adminDb
      .select({
        service: schema.apiUsage.service,
        operation: schema.apiUsage.operation,
        costUsd: COST,
        calls: CALLS,
      })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.createdAt, windowStart))
      .groupBy(schema.apiUsage.service, schema.apiUsage.operation)
      .orderBy(desc(sql`sum(${schema.apiUsage.estimatedCostUsd})`))
      .limit(10),
    adminDb.select().from(schema.teamMembers),
    adminDb.select().from(schema.teams),
  ]);

  const weekByUser = new Map(
    usersWeek.map((r) => [r.clerkUserId, Number(r.costUsd)]),
  );
  const dayByUser = new Map(
    usersDay.map((r) => [r.clerkUserId, Number(r.costUsd)]),
  );
  const memberByUser = new Map(
    memberRows.filter((m) => m.clerkUserId).map((m) => [m.clerkUserId!, m]),
  );
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const byUser: AnalyticsUserRow[] = users30d.map((r) => {
    const membership = memberByUser.get(r.clerkUserId) ?? null;
    const team = membership ? (teamById.get(membership.teamId) ?? null) : null;
    const ctx = { membership, team };
    const weeklyLimitUsd = effectiveUserWeeklyLimitUsd(ctx);
    const dailyLimitUsd = effectiveUserDailyLimitUsd(ctx);
    const weekSpendUsd = weekByUser.get(r.clerkUserId) ?? 0;
    const daySpendUsd = dayByUser.get(r.clerkUserId) ?? 0;
    return {
      clerkUserId: r.clerkUserId,
      email: membership?.email ?? null,
      teamName: team?.name ?? null,
      spend30dUsd: Number(r.costUsd),
      calls30d: r.calls,
      weekSpendUsd,
      daySpendUsd,
      weeklyLimitUsd,
      dailyLimitUsd,
      weekPctUsed: pct(weekSpendUsd, weeklyLimitUsd),
      dayPctUsed: pct(daySpendUsd, dailyLimitUsd),
      memberId: membership?.id ?? null,
      teamId: membership?.teamId ?? null,
      perUserWeeklyLimitUsd:
        membership?.perUserWeeklyLimitUsd != null
          ? Number(membership.perUserWeeklyLimitUsd)
          : null,
      perUserDailyLimitUsd:
        membership?.perUserDailyLimitUsd != null
          ? Number(membership.perUserDailyLimitUsd)
          : null,
    };
  });

  const payload: AnalyticsPayload = {
    dailySeries: daily.map((r) => ({
      date: r.date,
      costUsd: Number(r.costUsd),
      calls: r.calls,
    })),
    byUser,
    byService: services.map((r) => ({
      service: r.service,
      costUsd: Number(r.costUsd),
      calls: r.calls,
    })),
    byOperation: operations.map((r) => ({
      service: r.service,
      operation: r.operation,
      costUsd: Number(r.costUsd),
      calls: r.calls,
    })),
    windowStartIso: windowStart.toISOString(),
    weekStartIso: weekStart.toISOString(),
    dayStartIso: dayStart.toISOString(),
  };

  return Response.json(payload);
}
