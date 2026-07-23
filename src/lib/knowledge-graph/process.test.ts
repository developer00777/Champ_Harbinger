import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockLimit, mockProcessEpisode } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockProcessEpisode = vi.fn();
  return { mockLimit, mockProcessEpisode };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
        }),
      }),
    }),
  },
}));

vi.mock("./extract", () => ({ processEpisode: mockProcessEpisode }));

import { processPendingEpisodes } from "./process";

describe("processPendingEpisodes", () => {
  beforeEach(() => {
    mockLimit.mockReset();
    mockProcessEpisode.mockReset();
  });

  it("processes every pending episode and totals facts written", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "ep1" }, { id: "ep2" }]);
    mockProcessEpisode
      .mockResolvedValueOnce({ factsWritten: 2 })
      .mockResolvedValueOnce({ factsWritten: 0 });

    const result = await processPendingEpisodes(25);

    expect(result).toEqual({ processed: 2, errored: 0, factsWritten: 2 });
    expect(mockProcessEpisode).toHaveBeenCalledTimes(2);
  });

  it("counts a throwing episode as errored without halting the batch", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "ep1" }, { id: "ep2" }]);
    mockProcessEpisode
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ factsWritten: 1 });

    const result = await processPendingEpisodes(25);

    expect(result).toEqual({ processed: 1, errored: 1, factsWritten: 1 });
  });

  it("returns zeros when there is nothing pending", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await processPendingEpisodes(25);
    expect(result).toEqual({ processed: 0, errored: 0, factsWritten: 0 });
  });
});
