import { describe, expect, it, vi } from "vitest";

const { mockReturning, mockValues, mockInsert } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  return { mockReturning, mockValues, mockInsert };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: { insert: mockInsert, select: vi.fn(), update: vi.fn() },
}));

import { recordEpisode } from "./episodes";

describe("recordEpisode", () => {
  it("inserts a kg_episodes row and returns its id", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "ep-1" }]);

    const result = await recordEpisode({
      kind: "signal",
      refTable: "people",
      refId: "p1",
      content: { fact: "hello" },
    });

    expect(result).toEqual({ id: "ep-1" });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "signal",
        refTable: "people",
        refId: "p1",
        content: { fact: "hello" },
      }),
    );
  });

  it("defaults optional fields to null", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "ep-2" }]);
    await recordEpisode({ kind: "note", content: {} });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: null,
        refTable: null,
        refId: null,
      }),
    );
  });
});
