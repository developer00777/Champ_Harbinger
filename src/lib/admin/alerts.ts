import "server-only";

/**
 * Usage alerts: emails the admin when a team member crosses a threshold of
 * their effective daily or weekly cap.
 *
 * Thresholds come from appSettings "alert_thresholds" (fractions, default
 * [0.8, 1]). Dedupe: one appSettings marker key per user+period window —
 *
 *   alert_sent:<clerkUserId>:<daily|weekly>:<window-start YYYY-MM-DD>
 *
 * whose value is the highest threshold already alerted in that window. A new
 * email goes out only when a HIGHER threshold is crossed; when the window
 * rolls over the key changes so alerting naturally resets. Old marker rows are
 * inert and tiny (a few per user per day) — an occasional cleanup can delete
 * `alert_sent:%` keys older than a month if they ever bother anyone.
 *
 * All I/O is injectable (deps) so threshold/dedupe logic is unit-testable.
 */

export interface AlertMemberInfo {
  clerkUserId: string;
  email: string;
  teamName: string | null;
  dailyLimitUsd: number | null;
  weeklyLimitUsd: number | null;
}

export interface AlertsDeps {
  /** Active, linked members with their effective caps already resolved. */
  listMembers(): Promise<AlertMemberInfo[]>;
  daySpendUsd(clerkUserId: string): Promise<number>;
  weekSpendUsd(clerkUserId: string): Promise<number>;
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  sendEmail(input: { subject: string; text: string }): Promise<void>;
  /** null = alerts disabled (skip silently). */
  adminEmail: string | null;
  now(): Date;
}

export interface UsageAlert {
  clerkUserId: string;
  email: string;
  period: "daily" | "weekly";
  threshold: number;
  spentUsd: number;
  limitUsd: number;
}

export interface AlertsRunResult {
  membersChecked: number;
  alertsSent: UsageAlert[];
  skipped: "no_admin_email" | null;
}

export const DEFAULT_ALERT_THRESHOLDS = [0.8, 1];

/** Highest configured threshold that `fraction` has reached, or null. */
export function highestCrossedThreshold(
  fraction: number,
  thresholds: number[],
): number | null {
  let best: number | null = null;
  for (const t of thresholds) {
    if (fraction >= t && (best == null || t > best)) best = t;
  }
  return best;
}

function windowKey(
  clerkUserId: string,
  period: "daily" | "weekly",
  windowStart: Date,
): string {
  return `alert_sent:${clerkUserId}:${period}:${windowStart.toISOString().slice(0, 10)}`;
}

function normalizeThresholds(raw: unknown): number[] {
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
  ) {
    return [...raw].sort((a, b) => a - b);
  }
  return DEFAULT_ALERT_THRESHOLDS;
}

export async function checkUsageAlerts(
  deps: AlertsDeps,
): Promise<AlertsRunResult> {
  const { currentDayStartUtc, currentWeekStartUtc } =
    await import("@/lib/budget/spend");

  if (!deps.adminEmail) {
    return { membersChecked: 0, alertsSent: [], skipped: "no_admin_email" };
  }

  const thresholds = normalizeThresholds(
    await deps.getSetting("alert_thresholds"),
  );
  const now = deps.now();
  const dayStart = currentDayStartUtc(now);
  const weekStart = currentWeekStartUtc(now);

  const members = await deps.listMembers();
  const alertsSent: UsageAlert[] = [];

  for (const m of members) {
    const periods: Array<{
      period: "daily" | "weekly";
      limitUsd: number | null;
      windowStart: Date;
      spend: () => Promise<number>;
    }> = [
      {
        period: "daily",
        limitUsd: m.dailyLimitUsd,
        windowStart: dayStart,
        spend: () => deps.daySpendUsd(m.clerkUserId),
      },
      {
        period: "weekly",
        limitUsd: m.weeklyLimitUsd,
        windowStart: weekStart,
        spend: () => deps.weekSpendUsd(m.clerkUserId),
      },
    ];

    for (const p of periods) {
      if (p.limitUsd == null || p.limitUsd <= 0) continue;
      const spentUsd = await p.spend();
      const crossed = highestCrossedThreshold(
        spentUsd / p.limitUsd,
        thresholds,
      );
      if (crossed == null) continue;

      const key = windowKey(m.clerkUserId, p.period, p.windowStart);
      const already = await deps.getSetting(key);
      if (typeof already === "number" && already >= crossed) continue;

      const pctLabel = `${Math.round(crossed * 100)}%`;
      const subject = `[ChampHarbinger] ${m.email} at ${pctLabel} of ${p.period} budget`;
      const text = [
        `${m.email}${m.teamName ? ` (team ${m.teamName})` : ""} has crossed ${pctLabel} of their ${p.period} spend cap.`,
        ``,
        `Spent: $${spentUsd.toFixed(2)} of $${p.limitUsd.toFixed(2)} (${Math.round((spentUsd / p.limitUsd) * 100)}%)`,
        `Window start: ${p.windowStart.toISOString()}`,
        ``,
        `Adjust limits in the admin console.`,
      ].join("\n");

      try {
        await deps.sendEmail({ subject, text });
        // Marker only after a successful send, so a failed send retries.
        await deps.setSetting(key, crossed);
        console.log(
          `[alerts] sent ${p.period} ${pctLabel} alert for ${m.email} ($${spentUsd.toFixed(2)}/$${p.limitUsd.toFixed(2)})`,
        );
        alertsSent.push({
          clerkUserId: m.clerkUserId,
          email: m.email,
          period: p.period,
          threshold: crossed,
          spentUsd,
          limitUsd: p.limitUsd,
        });
      } catch (err) {
        console.error(`[alerts] failed to send alert for ${m.email}:`, err);
      }
    }
  }

  return { membersChecked: members.length, alertsSent, skipped: null };
}

/** Production deps: DB-backed members/spend/settings + the email provider. */
export async function defaultAlertsDeps(): Promise<AlertsDeps> {
  const [{ adminDb }, { schema }, { eq }, teams, spend, settings, email] =
    await Promise.all([
      import("@/lib/db/admin"),
      import("@/db"),
      import("drizzle-orm"),
      import("@/lib/teams"),
      import("@/lib/budget/spend"),
      import("@/lib/app-settings"),
      import("@/lib/email/provider"),
    ]);

  const adminEmail = process.env.ADMIN_ALERT_EMAIL?.trim() || null;
  const fromEmail =
    process.env.ALERT_FROM_EMAIL?.trim() || "alerts@champharbinger.local";

  return {
    adminEmail,
    now: () => new Date(),
    async listMembers() {
      const [memberRows, teamRows] = await Promise.all([
        adminDb
          .select()
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.status, "active")),
        adminDb.select().from(schema.teams),
      ]);
      const teamById = new Map(teamRows.map((t) => [t.id, t]));
      return memberRows
        .filter((m) => m.clerkUserId)
        .map((m) => {
          const team = teamById.get(m.teamId) ?? null;
          const ctx = { membership: m, team };
          return {
            clerkUserId: m.clerkUserId!,
            email: m.email,
            teamName: team?.name ?? null,
            dailyLimitUsd: teams.effectiveUserDailyLimitUsd(ctx),
            weeklyLimitUsd: teams.effectiveUserWeeklyLimitUsd(ctx),
          };
        });
    },
    daySpendUsd: (id) => spend.userDaySpendUsd(id),
    weekSpendUsd: (id) => spend.userWeekSpendUsd(id),
    getSetting: (key) => settings.getAppSetting(key),
    setSetting: (key, value) =>
      settings.setAppSetting(key, value, "usage-alerts"),
    async sendEmail({ subject, text }) {
      if (!adminEmail) return;
      const provider = email.getEmailProvider();
      const result = await provider.send({
        to: adminEmail,
        from: fromEmail,
        subject,
        text,
      });
      if (result.status === "failed") {
        throw new Error(result.error ?? "email provider reported failure");
      }
    },
  };
}

/** Convenience entry point for the cron route. */
export async function runUsageAlerts(): Promise<AlertsRunResult> {
  return checkUsageAlerts(await defaultAlertsDeps());
}
