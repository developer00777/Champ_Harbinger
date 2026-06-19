import "server-only";

import { asc } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import {
  currentWeekStartUtc,
  globalWeekSpendUsd,
  nextWeekStartUtc,
  teamWeekSpendUsd,
  userWeekSpendUsd,
} from "@/lib/budget/spend";
import { effectiveUserWeeklyLimitUsd } from "@/lib/teams";
import { fetchOpenRouterCredits } from "@/lib/services/real-spend";

export interface AdminTeamRow {
  id: string;
  name: string;
  weeklyLimitUsd: number | null;
  perUserDefaultWeeklyLimitUsd: number | null;
  hardStop: boolean;
  enabled: boolean;
  updatedBy: string | null;
  weekSpendUsd: number;
  memberCount: number;
}

export interface AdminMemberRow {
  id: string;
  teamId: string;
  teamName: string;
  email: string;
  clerkUserId: string | null;
  perUserWeeklyLimitUsd: number | null;
  status: string;
  role: string;
  invitedBy: string | null;
  weekSpendUsd: number;
  /** Effective per-user weekly cap (override → team default → null). */
  effectiveLimitUsd: number | null;
}

export interface AdminOverview {
  global: {
    weekSpendUsd: number;
    limitUsd: number | null;
    openrouterCreditUsd: number | null;
    weekStartIso: string;
    weekResetIso: string;
  };
  teams: AdminTeamRow[];
  members: AdminMemberRow[];
}

function envGlobalLimit(): number | null {
  const raw = process.env.GLOBAL_WEEKLY_BUDGET_USD;
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function num(v: string | null): number | null {
  return v == null ? null : Number(v);
}

/**
 * The whole admin console payload: global header numbers, every budget team
 * with its week spend + member count, and every member with week spend +
 * effective cap. Computed off the shared budget helpers so the admin view and
 * the live budget enforcement never disagree.
 */
export async function buildAdminOverview(): Promise<AdminOverview> {
  const weekStart = currentWeekStartUtc();

  const [teamRows, memberRows, globalSpend, credits] = await Promise.all([
    adminDb.select().from(schema.teams).orderBy(asc(schema.teams.name)),
    adminDb
      .select()
      .from(schema.teamMembers)
      .orderBy(asc(schema.teamMembers.email)),
    globalWeekSpendUsd(weekStart),
    fetchOpenRouterCredits(),
  ]);

  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  const teams: AdminTeamRow[] = await Promise.all(
    teamRows.map(async (t) => ({
      id: t.id,
      name: t.name,
      weeklyLimitUsd: num(t.weeklyLimitUsd),
      perUserDefaultWeeklyLimitUsd: num(t.perUserDefaultWeeklyLimitUsd),
      hardStop: t.hardStop,
      enabled: t.enabled,
      updatedBy: t.updatedBy,
      weekSpendUsd: await teamWeekSpendUsd(t.id, weekStart),
      memberCount: memberRows.filter((m) => m.teamId === t.id).length,
    })),
  );

  const members: AdminMemberRow[] = await Promise.all(
    memberRows.map(async (m) => {
      const team = teamRows.find((t) => t.id === m.teamId) ?? null;
      const effectiveLimitUsd = effectiveUserWeeklyLimitUsd({
        membership: m,
        team,
      });
      // Only linked users accrue spend (api_usage keys off clerkUserId).
      const weekSpendUsd = m.clerkUserId
        ? await userWeekSpendUsd(m.clerkUserId, weekStart)
        : 0;
      return {
        id: m.id,
        teamId: m.teamId,
        teamName: teamNameById.get(m.teamId) ?? "—",
        email: m.email,
        clerkUserId: m.clerkUserId,
        perUserWeeklyLimitUsd: num(m.perUserWeeklyLimitUsd),
        status: m.status,
        role: m.role,
        invitedBy: m.invitedBy,
        weekSpendUsd,
        effectiveLimitUsd,
      };
    }),
  );

  return {
    global: {
      weekSpendUsd: globalSpend,
      limitUsd: envGlobalLimit(),
      openrouterCreditUsd: credits ? credits.remaining : null,
      weekStartIso: weekStart.toISOString(),
      weekResetIso: nextWeekStartUtc().toISOString(),
    },
    teams,
    members,
  };
}
