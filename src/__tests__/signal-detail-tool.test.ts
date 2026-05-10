import { beforeEach, describe, expect, it, vi } from "vitest";

// Break circular dep: runner.ts → tool-registry.ts → allTools → signal-tools.ts
vi.mock("@/lib/signals/runner", () => ({ runRecipe: vi.fn() }));
vi.mock("@/lib/signals/executor", () => ({ executeSignal: vi.fn() }));

// getSignalDetail: db.select().from(schema.signals).where(eq(...)).limit(1)
const { mockLimit, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockLimit, mockSelect };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { getSignalDetail } from "@/lib/tools/signal-tools";

describe("getSignalDetail", () => {
  beforeEach(() => mockLimit.mockReset());

  it("returns full signal with recipe and config", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: "s1",
        name: "Hiring Surge",
        category: "hiring",
        description: "long description here",
        config: { threshold: 5 },
      },
    ]);
    const result = await getSignalDetail.execute!(
      { signalId: "s1" },
      {} as never,
    );
    expect(result).toMatchObject({
      id: "s1",
      config: { threshold: 5 },
    });
  });

  it("returns error on missing signal", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getSignalDetail.execute!(
      { signalId: "x" },
      {} as never,
    );
    expect(result).toEqual({ error: expect.stringContaining("not found") });
  });
});
