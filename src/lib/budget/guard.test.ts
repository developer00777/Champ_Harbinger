import { describe, expect, it } from "vitest";

import { createTtlCache, firstHardViolation } from "./guard";

describe("firstHardViolation", () => {
  it("returns null when every scope is under its limit", () => {
    expect(
      firstHardViolation([
        { scope: "global", limitUsd: 100, spentUsd: 50, hardStop: true },
        { scope: "team", limitUsd: 20, spentUsd: 5, hardStop: true },
      ]),
    ).toBeNull();
  });

  it("returns the over-limit hard-stop scope", () => {
    const v = firstHardViolation([
      { scope: "global", limitUsd: 100, spentUsd: 50, hardStop: true },
      { scope: "team", limitUsd: 20, spentUsd: 25, hardStop: true },
    ]);
    expect(v?.scope).toBe("team");
  });

  it("ignores soft (non-hardStop) over-limit scopes", () => {
    expect(
      firstHardViolation([
        { scope: "team", limitUsd: 20, spentUsd: 25, hardStop: false },
      ]),
    ).toBeNull();
  });

  it("treats a null limit as unlimited", () => {
    expect(
      firstHardViolation([
        { scope: "user", limitUsd: null, spentUsd: 9999, hardStop: true },
      ]),
    ).toBeNull();
  });

  it("returns the first violation in priority (list) order", () => {
    const v = firstHardViolation([
      { scope: "global", limitUsd: 10, spentUsd: 50, hardStop: true },
      { scope: "user", limitUsd: 5, spentUsd: 50, hardStop: true },
    ]);
    expect(v?.scope).toBe("global");
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
