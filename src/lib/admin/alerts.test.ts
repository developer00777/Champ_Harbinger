import { describe, expect, it, vi } from "vitest";

import {
  type AlertsDeps,
  checkUsageAlerts,
  highestCrossedThreshold,
} from "./alerts";

const NOW = new Date("2026-07-18T12:00:00.000Z"); // Saturday

function makeDeps(overrides?: Partial<AlertsDeps>): {
  deps: AlertsDeps;
  settings: Map<string, unknown>;
  sendEmail: ReturnType<typeof vi.fn>;
} {
  const settings = new Map<string, unknown>();
  const sendEmail = vi.fn(async () => {});
  const deps: AlertsDeps = {
    adminEmail: "admin@example.com",
    now: () => NOW,
    listMembers: async () => [
      {
        clerkUserId: "user_1",
        email: "u1@example.com",
        teamName: "Growth",
        dailyLimitUsd: 10,
        weeklyLimitUsd: 50,
      },
    ],
    daySpendUsd: async () => 0,
    weekSpendUsd: async () => 0,
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => {
      settings.set(key, value);
    },
    sendEmail,
    ...overrides,
  };
  return { deps, settings, sendEmail };
}

describe("highestCrossedThreshold", () => {
  it("returns null below every threshold", () => {
    expect(highestCrossedThreshold(0.5, [0.8, 1])).toBeNull();
  });
  it("returns the highest threshold reached", () => {
    expect(highestCrossedThreshold(0.85, [0.8, 1])).toBe(0.8);
    expect(highestCrossedThreshold(1.2, [0.8, 1])).toBe(1);
  });
});

describe("checkUsageAlerts", () => {
  it("skips silently when ADMIN_ALERT_EMAIL is unset", async () => {
    const { deps, sendEmail } = makeDeps({ adminEmail: null });
    const result = await checkUsageAlerts(deps);
    expect(result.skipped).toBe("no_admin_email");
    expect(result.alertsSent).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when spend is under every threshold", async () => {
    const { deps, sendEmail } = makeDeps({
      daySpendUsd: async () => 1,
      weekSpendUsd: async () => 10,
    });
    const result = await checkUsageAlerts(deps);
    expect(result.alertsSent).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("alerts on the highest crossed threshold per period", async () => {
    const { deps, sendEmail } = makeDeps({
      daySpendUsd: async () => 9, // 90% of 10 → crosses 0.8
      weekSpendUsd: async () => 55, // 110% of 50 → crosses 1.0
    });
    const result = await checkUsageAlerts(deps);
    expect(result.alertsSent).toEqual([
      expect.objectContaining({ period: "daily", threshold: 0.8 }),
      expect.objectContaining({ period: "weekly", threshold: 1 }),
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("dedupes: does not re-alert the same threshold in the same window", async () => {
    const { deps, sendEmail } = makeDeps({
      daySpendUsd: async () => 9,
    });
    const first = await checkUsageAlerts(deps);
    expect(first.alertsSent).toHaveLength(1);
    const second = await checkUsageAlerts(deps);
    expect(second.alertsSent).toHaveLength(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("escalates: re-alerts when a HIGHER threshold is crossed later", async () => {
    let daySpend = 9; // 90% → 0.8 alert
    const { deps, sendEmail } = makeDeps({
      daySpendUsd: async () => daySpend,
    });
    await checkUsageAlerts(deps);
    daySpend = 11; // 110% → 1.0 alert
    const result = await checkUsageAlerts(deps);
    expect(result.alertsSent).toEqual([
      expect.objectContaining({ period: "daily", threshold: 1 }),
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("uses configured alert_thresholds from settings", async () => {
    const { deps, settings, sendEmail } = makeDeps({
      daySpendUsd: async () => 6, // 60%
    });
    settings.set("alert_thresholds", [0.5]);
    const result = await checkUsageAlerts(deps);
    expect(result.alertsSent).toEqual([
      expect.objectContaining({ period: "daily", threshold: 0.5 }),
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("skips members with no caps", async () => {
    const { deps, sendEmail } = makeDeps({
      listMembers: async () => [
        {
          clerkUserId: "user_2",
          email: "u2@example.com",
          teamName: null,
          dailyLimitUsd: null,
          weeklyLimitUsd: null,
        },
      ],
      daySpendUsd: async () => 999,
      weekSpendUsd: async () => 999,
    });
    const result = await checkUsageAlerts(deps);
    expect(result.alertsSent).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not write the dedupe marker when the send fails (so it retries)", async () => {
    let fail = true;
    const sendEmail = vi.fn(async () => {
      if (fail) throw new Error("smtp down");
    });
    const { deps } = makeDeps({ sendEmail, daySpendUsd: async () => 9 });
    const first = await checkUsageAlerts(deps);
    expect(first.alertsSent).toHaveLength(0);
    fail = false;
    const second = await checkUsageAlerts(deps);
    expect(second.alertsSent).toHaveLength(1);
  });
});
