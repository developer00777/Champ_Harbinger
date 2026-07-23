import { describe, expect, it, vi } from "vitest";

import {
  assertDailyCapNotExceeded,
  assertDomainHealthy,
  assertThrottleOk,
  DEFAULT_DAILY_SEND_CAP,
  GuardrailViolationError,
  MIN_THROTTLE_MS,
  randomizedMinGapMs,
  runSendGuardrails,
  THROTTLE_JITTER_MS,
  type MailboxForGuardrails,
} from "./guardrails";

const mailbox: MailboxForGuardrails = {
  id: "mbx_1",
  clerkUserId: "user_1",
  fromAddress: "alex@example.com",
};

describe("assertDailyCapNotExceeded", () => {
  it("allows sending while under the cap", async () => {
    const countFn = vi.fn().mockResolvedValue(5);
    const result = await assertDailyCapNotExceeded(mailbox, {
      cap: 35,
      countFn,
    });
    expect(result).toEqual({ sentToday: 5, cap: 35 });
  });

  it("blocks the Nth send once the daily cap is exceeded (mocked sentEmails count)", async () => {
    const cap = 10;
    // Simulate exactly the cap already sent today — the next (Nth+1) send
    // must be refused.
    const countFn = vi.fn().mockResolvedValue(cap);
    await expect(
      assertDailyCapNotExceeded(mailbox, { cap, countFn }),
    ).rejects.toMatchObject({
      code: "daily_cap",
    });
  });

  it("blocks once count exceeds the cap, not just at cap", async () => {
    const countFn = vi.fn().mockResolvedValue(999);
    await expect(
      assertDailyCapNotExceeded(mailbox, { cap: 35, countFn }),
    ).rejects.toBeInstanceOf(GuardrailViolationError);
  });

  it("uses the provisional default cap when none is specified", async () => {
    expect(DEFAULT_DAILY_SEND_CAP).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_DAILY_SEND_CAP).toBeLessThanOrEqual(40);
    const countFn = vi.fn().mockResolvedValue(0);
    const result = await assertDailyCapNotExceeded(mailbox, { countFn });
    expect(result.cap).toBe(DEFAULT_DAILY_SEND_CAP);
  });
});

describe("randomizedMinGapMs", () => {
  it("is jittered, not a fixed interval — repeated calls vary", () => {
    let seed = 0;
    // Deterministic but different values per call.
    const rand = () => {
      seed += 0.13;
      return seed % 1;
    };
    const gaps = Array.from({ length: 5 }, () => randomizedMinGapMs(rand));
    const distinctValues = new Set(gaps);
    expect(distinctValues.size).toBeGreaterThan(1);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(MIN_THROTTLE_MS);
      expect(gap).toBeLessThan(MIN_THROTTLE_MS + THROTTLE_JITTER_MS);
    }
  });

  it("never goes below the floor even with rand() = 0", () => {
    expect(randomizedMinGapMs(() => 0)).toBe(MIN_THROTTLE_MS);
  });
});

describe("assertThrottleOk", () => {
  it("allows the first-ever send (no prior send recorded)", async () => {
    const lastSentFn = vi.fn().mockResolvedValue(null);
    const result = await assertThrottleOk(mailbox, { lastSentFn });
    expect(result.elapsedMs).toBeNull();
  });

  it("enforces a minimum randomized gap, not an exact fixed interval", async () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const last = new Date(now.getTime() - 10_000); // only 10s ago
    const lastSentFn = vi.fn().mockResolvedValue(last);
    // rand() = 0 => required gap == MIN_THROTTLE_MS exactly (the floor),
    // and 10s < floor, so this must throw.
    await expect(
      assertThrottleOk(mailbox, {
        now,
        lastSentFn,
        rand: () => 0,
      }),
    ).rejects.toMatchObject({ code: "throttle" });
  });

  it("allows sending once the randomized gap has elapsed", async () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const last = new Date(now.getTime() - (MIN_THROTTLE_MS + 1));
    const lastSentFn = vi.fn().mockResolvedValue(last);
    const result = await assertThrottleOk(mailbox, {
      now,
      lastSentFn,
      rand: () => 0, // required gap == floor, which has now elapsed
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(MIN_THROTTLE_MS);
  });

  it("two consecutive throttle checks with different jitter draws require different gaps", async () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const lastSentFn = vi
      .fn()
      .mockResolvedValue(new Date(now.getTime() - 60_000));
    const low = await assertThrottleOk(mailbox, {
      now,
      lastSentFn,
      rand: () => 0,
    });
    await expect(
      assertThrottleOk(mailbox, { now, lastSentFn, rand: () => 0.99 }),
    ).rejects.toMatchObject({ code: "throttle" });
    expect(low.requiredGapMs).toBeLessThan(
      MIN_THROTTLE_MS + THROTTLE_JITTER_MS,
    );
  });
});

describe("assertDomainHealthy", () => {
  it("is not_applicable (passes) for mailboxes not tied to an InboxKit domain", async () => {
    const result = await assertDomainHealthy(mailbox);
    expect(result).toEqual({ healthy: true, source: "not_applicable" });
  });

  it("hard-blocks send when the InboxKit domain is unverified/unhealthy, even though skip was requested", async () => {
    const inboxkitMailbox: MailboxForGuardrails = {
      ...mailbox,
      config: { infraProvider: "inboxkit", infraDomain: "coldoutbound.dev" },
    };
    const getCachedFn = vi
      .fn()
      .mockResolvedValue({ healthy: false, status: "pending" });
    const getLiveFn = vi
      .fn()
      .mockResolvedValue({ healthy: false, status: "pending" });

    // Note: assertDomainHealthy's options type has no "skip" field at all —
    // this simulates a caller trying to pass one anyway (e.g. from a loosely
    // typed JS call site) and proves it has no effect.
    const optsWithAttemptedSkip = {
      getCachedFn,
      getLiveFn,
      skipCheck: true,
    } as Parameters<typeof assertDomainHealthy>[1];

    await expect(
      assertDomainHealthy(inboxkitMailbox, optsWithAttemptedSkip),
    ).rejects.toMatchObject({ code: "domain_unhealthy" });
    expect(getCachedFn).toHaveBeenCalledWith("coldoutbound.dev");
    expect(getLiveFn).toHaveBeenCalledWith("coldoutbound.dev");
  });

  it("passes when the cached order reports a healthy domain", async () => {
    const inboxkitMailbox: MailboxForGuardrails = {
      ...mailbox,
      config: { infraProvider: "inboxkit", infraDomain: "coldoutbound.dev" },
    };
    const getCachedFn = vi
      .fn()
      .mockResolvedValue({ healthy: true, status: "active" });
    const getLiveFn = vi.fn();
    const result = await assertDomainHealthy(inboxkitMailbox, {
      getCachedFn,
      getLiveFn,
    });
    expect(result).toEqual({ healthy: true, source: "cache" });
    expect(getLiveFn).not.toHaveBeenCalled();
  });

  it("falls back to a live check and fails closed when the provider errors", async () => {
    const inboxkitMailbox: MailboxForGuardrails = {
      ...mailbox,
      config: { infraProvider: "inboxkit", infraDomain: "coldoutbound.dev" },
    };
    const getCachedFn = vi.fn().mockResolvedValue(null);
    const getLiveFn = vi.fn().mockResolvedValue(null); // e.g. provider not configured / errored
    await expect(
      assertDomainHealthy(inboxkitMailbox, { getCachedFn, getLiveFn }),
    ).rejects.toBeInstanceOf(GuardrailViolationError);
  });
});

describe("runSendGuardrails", () => {
  it("runs all three checks and reports each result when all pass", async () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const report = await runSendGuardrails(mailbox, {
      now,
      countFn: async () => 1,
      lastSentFn: async () => null,
      rand: () => 0,
    });
    expect(report.dailyCap.sentToday).toBe(1);
    expect(report.throttle.elapsedMs).toBeNull();
    expect(report.domainHealth.source).toBe("not_applicable");
  });

  it("stops at the first violation (daily cap) without evaluating throttle/domain", async () => {
    const lastSentFn = vi.fn();
    await expect(
      runSendGuardrails(mailbox, {
        cap: 5,
        countFn: async () => 5,
        lastSentFn,
      }),
    ).rejects.toMatchObject({ code: "daily_cap" });
    expect(lastSentFn).not.toHaveBeenCalled();
  });
});
