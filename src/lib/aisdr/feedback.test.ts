import { describe, expect, it, vi, beforeEach } from "vitest";

const { state } = vi.hoisted(() => {
  return {
    state: {
      reviewFeedback: [] as Record<string, unknown>[],
      updateSetCalls: [] as Record<string, unknown>[],
    },
  };
});

vi.mock("@/db", () => ({
  schema: {
    emailDrafts: { id: "emailDrafts.id" },
  },
}));

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi
            .fn()
            .mockResolvedValue([{ reviewFeedback: state.reviewFeedback }]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        state.updateSetCalls.push(patch);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  },
}));

import { computeDiff, recordFeedback } from "./feedback";

describe("computeDiff", () => {
  it("returns no diffs when nothing changed", () => {
    const diffs = computeDiff(
      { subject: "Hi", bodyHtml: "<p>a</p>", bodyText: "a" },
      {},
    );
    expect(diffs).toEqual([]);
  });

  it("captures a changed subject", () => {
    const diffs = computeDiff(
      { subject: "Hi", bodyHtml: "<p>a</p>", bodyText: "a" },
      { subject: "Hello there" },
    );
    expect(diffs).toEqual([
      { field: "subject", before: "Hi", after: "Hello there" },
    ]);
  });

  it("captures changed body fields independently", () => {
    const diffs = computeDiff(
      { subject: "Hi", bodyHtml: "<p>a</p>", bodyText: "a" },
      { bodyHtml: "<p>b</p>", bodyText: "b" },
    );
    expect(diffs).toHaveLength(2);
    expect(diffs.map((d) => d.field).sort()).toEqual(["bodyHtml", "bodyText"]);
  });

  it("does not report a diff when the edited value equals the original", () => {
    const diffs = computeDiff(
      { subject: "Hi", bodyHtml: "<p>a</p>", bodyText: "a" },
      { subject: "Hi" },
    );
    expect(diffs).toEqual([]);
  });
});

describe("recordFeedback", () => {
  beforeEach(() => {
    state.reviewFeedback = [{ action: "edited", recordedAt: "earlier" }];
    state.updateSetCalls = [];
  });

  it("appends a structured feedback entry to reviewFeedback without discarding history", async () => {
    await recordFeedback({
      draftId: "draft1",
      action: "edited",
      diffs: [{ field: "subject", before: "Hi", after: "Hello" }],
    });

    expect(state.updateSetCalls).toHaveLength(1);
    const patch = state.updateSetCalls[0];
    const feedback = patch.reviewFeedback as Record<string, unknown>[];
    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toEqual({ action: "edited", recordedAt: "earlier" });
    expect(feedback[1]).toMatchObject({ action: "edited" });
    expect(patch.rejectionReason).toBeUndefined();
  });

  it("sets rejectionReason when the action is rejected", async () => {
    await recordFeedback({
      draftId: "draft1",
      action: "rejected",
      reason: "not relevant",
    });

    const patch = state.updateSetCalls[0];
    expect(patch.rejectionReason).toBe("not relevant");
  });

  it("never throws, even if the DB update fails", async () => {
    const { adminDb } = await import("@/lib/db/admin");
    (adminDb.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(
      recordFeedback({ draftId: "draft1", action: "rejected", reason: "bad" }),
    ).resolves.toBeUndefined();
  });
});
