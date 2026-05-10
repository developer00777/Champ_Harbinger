import { describe, expect, it, vi } from "vitest";

// Break circular dep: runner.ts → tool-registry.ts → allTools → signal-tools.ts
vi.mock("@/lib/signals/runner", () => ({ runRecipe: vi.fn() }));
vi.mock("@/lib/signals/executor", () => ({ executeSignal: vi.fn() }));

// getCampaignSignals runs two queries via Promise.all:
// 1. db.select({...}).from(schema.signals).orderBy(...)        -> allSignals
// 2. db.select({...}).from(schema.campaignSignals).where(...)  -> toggles

const { mockSelect } = vi.hoisted(() => {
  let callCount = 0;

  const makeChainForCall = (callIndex: number) => {
    if (callIndex === 1) {
      // signals query — ends with .orderBy()
      const orderBy = vi.fn().mockResolvedValue([
        {
          id: "s1",
          name: "Hiring Surge",
          category: "hiring",
          description: "Company is hiring aggressively...",
          isBuiltin: true,
        },
      ]);
      const where = vi.fn().mockReturnValue({ orderBy });
      return { from: vi.fn().mockReturnValue({ where, orderBy }) };
    }
    // campaignSignals query — ends with .where()
    const where = vi
      .fn()
      .mockResolvedValue([{ signalId: "s1", enabled: true }]);
    return { from: vi.fn().mockReturnValue({ where }) };
  };

  const mockSelect = vi.fn().mockImplementation(() => {
    callCount++;
    return makeChainForCall(callCount);
  });

  return { mockSelect };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { getCampaignSignals } from "@/lib/tools/signal-tools";

describe("getCampaignSignals return shape", () => {
  it("returns thin rows without recipe/config blobs", async () => {
    const result = (await getCampaignSignals.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { signals: Array<Record<string, unknown>> };

    expect(result.signals).toHaveLength(1);
    const s = result.signals[0];
    expect(s).not.toHaveProperty("recipe");
    expect(s).not.toHaveProperty("config");
    expect(s).not.toHaveProperty("config_override");
    expect(JSON.stringify(s)).not.toContain("BIG_BLOB_THAT_SHOULD_NOT_APPEAR");
    expect(s).toMatchObject({
      id: "s1",
      name: "Hiring Surge",
      category: "hiring",
      enabled: true,
    });
  });
});
