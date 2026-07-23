import { describe, expect, it } from "vitest";

import {
  BudgetExceededError,
  createTtlCache,
  firstHardViolation,
} from "./guard";

describe("firstHardViolation", () => {
  it("returns null when every scope is under its limit", () => {
    expect(
      firstHardViolation([
        {
          scope: "global",
          period: "weekly",
          limitUsd: 100,
          spentUsd: 50,
          hardStop: true,
        },
        {
          scope: "team",
          period: "weekly",
          limitUsd: 20,
          spentUsd: 5,
          hardStop: true,
        },
      ]),
    ).toBeNull();
  });

  it("returns the over-limit hard-stop scope", () => {
    const v = firstHardViolation([
      {
        scope: "global",
        period: "weekly",
        limitUsd: 100,
        spentUsd: 50,
        hardStop: true,
      },
      {
        scope: "team",
        period: "weekly",
        limitUsd: 20,
        spentUsd: 25,
        hardStop: true,
      },
    ]);
    expect(v?.scope).toBe("team");
  });

  it("ignores soft (non-hardStop) over-limit scopes", () => {
    expect(
      firstHardViolation([
        {
          scope: "team",
          period: "weekly",
          limitUsd: 20,
          spentUsd: 25,
          hardStop: false,
        },
      ]),
    ).toBeNull();
  });

  it("treats a null limit as unlimited", () => {
    expect(
      firstHardViolation([
        {
          scope: "user",
          period: "weekly",
          limitUsd: null,
          spentUsd: 9999,
          hardStop: true,
        },
      ]),
    ).toBeNull();
  });

  it("returns the first violation in priority (list) order", () => {
    const v = firstHardViolation([
      {
        scope: "global",
        period: "weekly",
        limitUsd: 10,
        spentUsd: 50,
        hardStop: true,
      },
      {
        scope: "user",
        period: "weekly",
        limitUsd: 5,
        spentUsd: 50,
        hardStop: true,
      },
    ]);
    expect(v?.scope).toBe("global");
  });

  it("prefers a daily violation listed before a weekly one (daily-first order)", () => {
    // assertWithinBudget pushes daily checks first; the earlier entry wins.
    const v = firstHardViolation([
      {
        scope: "user",
        period: "daily",
        limitUsd: 5,
        spentUsd: 6,
        hardStop: true,
      },
      {
        scope: "user",
        period: "weekly",
        limitUsd: 20,
        spentUsd: 25,
        hardStop: true,
      },
    ]);
    expect(v?.period).toBe("daily");
  });

  it("falls through to a weekly violation when the daily cap is fine", () => {
    const v = firstHardViolation([
      {
        scope: "user",
        period: "daily",
        limitUsd: 5,
        spentUsd: 1,
        hardStop: true,
      },
      {
        scope: "team",
        period: "weekly",
        limitUsd: 20,
        spentUsd: 25,
        hardStop: true,
      },
    ]);
    expect(v?.period).toBe("weekly");
    expect(v?.scope).toBe("team");
  });
});

describe("BudgetExceededError", () => {
  it("defaults to a weekly message and carries the period", () => {
    const resets = new Date("2026-07-20T00:00:00.000Z");
    const err = new BudgetExceededError("user", 10, 12, resets);
    expect(err.period).toBe("weekly");
    expect(err.message).toContain("Weekly user budget reached");
    expect(err.message).toContain("$12.00 of $10.00");
  });

  it("renders a daily message when period is daily", () => {
    const resets = new Date("2026-07-19T00:00:00.000Z");
    const err = new BudgetExceededError(
      "team",
      5,
      7,
      resets,
      "budget",
      "daily",
    );
    expect(err.period).toBe("daily");
    expect(err.message).toContain("Daily team budget reached");
    expect(err.message).toContain(resets.toISOString());
  });
});

describe("createTtlCache", () => {
  it("caches within the TTL and refetches after expiry", async () => {
    let clock = 1000;
    let calls = 0;
    const cache = createTtlCache<number>(100, () => clock);
    const fetch = async () => {
      calls++;
      return calls * 10;
    };
    expect(await cache.get("k", fetch)).toBe(10);
    expect(await cache.get("k", fetch)).toBe(10); // served from cache
    expect(calls).toBe(1);
    clock += 150; // past TTL
    expect(await cache.get("k", fetch)).toBe(20); // refetched
    expect(calls).toBe(2);
  });

  it("caches each key independently", async () => {
    let n = 0;
    const cache = createTtlCache<number>(1000, () => 0);
    const fetch = async () => ++n;
    expect(await cache.get("a", fetch)).toBe(1);
    expect(await cache.get("b", fetch)).toBe(2);
    expect(await cache.get("a", fetch)).toBe(1); // still cached
  });
});
