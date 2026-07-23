/**
 * Spend enforcement. Stops paid work when a user / their team / the whole
 * instance is over its daily or weekly cap. Checked at coarse entry points
 * (heavy job intake + chat), NOT per LLM call, via a short-TTL cached spend
 * tally so we don't hit the DB on every request.
 *
 * Resolution order (first hard violation wins): daily caps first
 * (global -> team -> user), then weekly caps (global -> team -> user). Daily
 * comes first because when both are blown the daily window resets sooner —
 * the error the user sees carries the most actionable reset time.
 */

export type BudgetScope = "global" | "team" | "user";
export type BudgetPeriod = "daily" | "weekly";

export interface BudgetCheck {
  scope: BudgetScope;
  period: BudgetPeriod;
  limitUsd: number | null; // null = unlimited
  spentUsd: number;
  hardStop: boolean; // false = warn only, never blocks
}

export class BudgetExceededError extends Error {
  readonly scope: BudgetScope;
  readonly period: BudgetPeriod;
  readonly limitUsd: number;
  readonly spentUsd: number;
  readonly resetsAt: Date;
  readonly reason: "budget" | "team_disabled";

  constructor(
    scope: BudgetScope,
    limitUsd: number,
    spentUsd: number,
    resetsAt: Date,
    reason: "budget" | "team_disabled" = "budget",
    period: BudgetPeriod = "weekly",
  ) {
    super(
      reason === "team_disabled"
        ? "Your team has been paused by an administrator."
        : `${period === "daily" ? "Daily" : "Weekly"} ${scope} budget reached ($${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)}). Resets ${resetsAt.toISOString()}.`,
    );
    this.name = "BudgetExceededError";
    this.scope = scope;
    this.period = period;
    this.limitUsd = limitUsd;
    this.spentUsd = spentUsd;
    this.resetsAt = resetsAt;
    this.reason = reason;
  }
}

/** First hard-stop scope that is at/over its limit, in list (priority) order. */
export function firstHardViolation(checks: BudgetCheck[]): BudgetCheck | null {
  for (const c of checks) {
    if (c.hardStop && c.limitUsd != null && c.spentUsd >= c.limitUsd) {
      return c;
    }
  }
  return null;
}

export interface TtlCache<V> {
  get(key: string, fetch: () => Promise<V>): Promise<V>;
}

/** Tiny per-key TTL cache (clock injectable for testing). */
export function createTtlCache<V>(
  ttlMs: number,
  now: () => number = () => Date.now(),
): TtlCache<V> {
  const store = new Map<string, { value: V; expiresAt: number }>();
  return {
    async get(key, fetch) {
      const t = now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > t) return hit.value;
      const value = await fetch();
      store.set(key, { value, expiresAt: t + ttlMs });
      return value;
    },
  };
}

function budgetCacheTtlMs(): number {
  const n = Number(process.env.BUDGET_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

function envLimitUsd(name: string): number | null {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function globalWeeklyLimitUsd(): number | null {
  return envLimitUsd("GLOBAL_WEEKLY_BUDGET_USD");
}

function globalDailyLimitUsd(): number | null {
  return envLimitUsd("GLOBAL_DAILY_BUDGET_USD");
}

// Per-process cached spend tallies, keyed by scope+period. Pinned to
// globalThis so the app + (dev) hot reloads share one cache.
function spendCache(): TtlCache<number> {
  const g = globalThis as typeof globalThis & {
    __harbinger_budget_cache?: TtlCache<number>;
  };
  if (!g.__harbinger_budget_cache) {
    g.__harbinger_budget_cache = createTtlCache<number>(budgetCacheTtlMs());
  }
  return g.__harbinger_budget_cache;
}

/**
 * Throws BudgetExceededError if `userId` (or their team, or the instance) is
 * over a hard daily or weekly cap. No-ops when no caps apply. DB modules are
 * imported dynamically so this file's pure helpers stay unit-testable.
 */
export async function assertWithinBudget(args: {
  userId: string;
}): Promise<void> {
  const { userId } = args;
  const [teams, spend] = await Promise.all([
    import("@/lib/teams"),
    import("@/lib/budget/spend"),
  ]);
  const cache = spendCache();
  const ctx = await teams.getMemberContext(userId);

  // A paused team blocks immediately, regardless of spend.
  if (ctx.team && !ctx.team.enabled) {
    throw new BudgetExceededError(
      "team",
      0,
      0,
      spend.nextWeekStartUtc(),
      "team_disabled",
    );
  }

  const checks: BudgetCheck[] = [];

  // ── Daily caps (global -> team -> user) ────────────────────────────────────

  const gDailyLimit = globalDailyLimitUsd();
  if (gDailyLimit != null) {
    const gSpent = await cache.get("global:day", () =>
      spend.globalDaySpendUsd(),
    );
    checks.push({
      scope: "global",
      period: "daily",
      limitUsd: gDailyLimit,
      spentUsd: gSpent,
      hardStop: true,
    });
  }

  if (ctx.team?.dailyLimitUsd != null) {
    const teamId = ctx.team.id;
    const tSpent = await cache.get(`team:${teamId}:day`, () =>
      spend.teamDaySpendUsd(teamId),
    );
    checks.push({
      scope: "team",
      period: "daily",
      limitUsd: Number(ctx.team.dailyLimitUsd),
      spentUsd: tSpent,
      hardStop: ctx.team.hardStop,
    });
  }

  const userDailyLimit = teams.effectiveUserDailyLimitUsd(ctx);
  if (userDailyLimit != null) {
    const uSpent = await cache.get(`user:${userId}:day`, () =>
      spend.userDaySpendUsd(userId),
    );
    checks.push({
      scope: "user",
      period: "daily",
      limitUsd: userDailyLimit,
      spentUsd: uSpent,
      hardStop: ctx.team?.hardStop ?? true,
    });
  }

  // ── Weekly caps (global -> team -> user) ───────────────────────────────────

  const gLimit = globalWeeklyLimitUsd();
  if (gLimit != null) {
    const gSpent = await cache.get("global", () => spend.globalWeekSpendUsd());
    checks.push({
      scope: "global",
      period: "weekly",
      limitUsd: gLimit,
      spentUsd: gSpent,
      hardStop: true,
    });
  }

  if (ctx.team?.weeklyLimitUsd != null) {
    const teamId = ctx.team.id;
    const tSpent = await cache.get(`team:${teamId}`, () =>
      spend.teamWeekSpendUsd(teamId),
    );
    checks.push({
      scope: "team",
      period: "weekly",
      limitUsd: Number(ctx.team.weeklyLimitUsd),
      spentUsd: tSpent,
      hardStop: ctx.team.hardStop,
    });
  }

  const userLimit = teams.effectiveUserWeeklyLimitUsd(ctx);
  if (userLimit != null) {
    const uSpent = await cache.get(`user:${userId}`, () =>
      spend.userWeekSpendUsd(userId),
    );
    checks.push({
      scope: "user",
      period: "weekly",
      limitUsd: userLimit,
      spentUsd: uSpent,
      hardStop: ctx.team?.hardStop ?? true,
    });
  }

  const violation = firstHardViolation(checks);
  if (violation) {
    throw new BudgetExceededError(
      violation.scope,
      violation.limitUsd ?? 0,
      violation.spentUsd,
      violation.period === "daily"
        ? spend.nextDayStartUtc()
        : spend.nextWeekStartUtc(),
      "budget",
      violation.period,
    );
  }
}
