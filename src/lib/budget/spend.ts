import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";

/**
 * Weekly spend rollups off the existing `api_usage` table (which already stores
 * real OpenRouter cost in `estimated_cost_usd`). The week window is computed in
 * JS as Monday 00:00:00 UTC so it's unambiguous regardless of DB timezone.
 *
 * Teams are budget groups: team spend = sum over the team's members (JOIN
 * team_members). Cheap at our scale; uses the (clerk_user_id, created_at) index.
 */

/** Monday 00:00:00.000 UTC of the week containing `now`. */
export function currentWeekStartUtc(now: Date = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const mondayOffset = (d.getUTCDay() + 6) % 7; // Sun=6, Mon=0 ... Sat=5
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

/** Start of next week (when the current weekly budget resets). */
export function nextWeekStartUtc(now: Date = new Date()): Date {
  const s = currentWeekStartUtc(now);
  s.setUTCDate(s.getUTCDate() + 7);
  return s;
}

/** 00:00:00.000 UTC of the day containing `now`. */
export function currentDayStartUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Start of the next UTC day (when the current daily budget resets). */
export function nextDayStartUtc(now: Date = new Date()): Date {
  const s = currentDayStartUtc(now);
  s.setUTCDate(s.getUTCDate() + 1);
  return s;
}

const SUM = sql<string>`coalesce(sum(${schema.apiUsage.estimatedCostUsd}), 0)::text`;

function toUsd(rows: Array<{ total: string }>): number {
  return Number(rows[0]?.total ?? 0);
}

export async function userWeekSpendUsd(
  clerkUserId: string,
  weekStart: Date = currentWeekStartUtc(),
): Promise<number> {
  const rows = await adminDb
    .select({ total: SUM })
    .from(schema.apiUsage)
    .where(
      and(
        eq(schema.apiUsage.clerkUserId, clerkUserId),
        gte(schema.apiUsage.createdAt, weekStart),
      ),
    );
  return toUsd(rows);
}

export async function teamWeekSpendUsd(
  teamId: string,
  weekStart: Date = currentWeekStartUtc(),
): Promise<number> {
  const rows = await adminDb
    .select({ total: SUM })
    .from(schema.apiUsage)
    .innerJoin(
      schema.teamMembers,
      eq(schema.teamMembers.clerkUserId, schema.apiUsage.clerkUserId),
    )
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        gte(schema.apiUsage.createdAt, weekStart),
      ),
    );
  return toUsd(rows);
}

export async function globalWeekSpendUsd(
  weekStart: Date = currentWeekStartUtc(),
): Promise<number> {
  const rows = await adminDb
    .select({ total: SUM })
    .from(schema.apiUsage)
    .where(gte(schema.apiUsage.createdAt, weekStart));
  return toUsd(rows);
}

// ─── Daily windows ────────────────────────────────────────────────────────────
// Same rollups over the UTC-day window. They reuse the weekly query functions:
// those only care about the window start, not its length.

export async function userDaySpendUsd(
  clerkUserId: string,
  dayStart: Date = currentDayStartUtc(),
): Promise<number> {
  return userWeekSpendUsd(clerkUserId, dayStart);
}

export async function teamDaySpendUsd(
  teamId: string,
  dayStart: Date = currentDayStartUtc(),
): Promise<number> {
  return teamWeekSpendUsd(teamId, dayStart);
}

export async function globalDaySpendUsd(
  dayStart: Date = currentDayStartUtc(),
): Promise<number> {
  return globalWeekSpendUsd(dayStart);
}
