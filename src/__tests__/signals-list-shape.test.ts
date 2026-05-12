import { describe, expect, it, vi } from "vitest";

// Break circular dep: runner.ts → tool-registry.ts → allTools → signal-tools.ts
vi.mock("@/lib/signals/runner", () => ({ runRecipe: vi.fn() }));
vi.mock("@/lib/signals/executor", () => ({ executeSignal: vi.fn() }));

// The tool calls: db.select({...}).from(schema.signals).where(...).orderBy(...)
const { mockSelect } = vi.hoisted(() => {
  const mockOrderBy = vi.fn().mockResolvedValue([
    {
      id: "s1",
      name: "Hiring Surge",
      category: "hiring",
      description: "short",
      isBuiltin: true,
    },
  ]);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi
    .fn()
    .mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
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

import { getSignals } from "@/lib/tools/signal-tools";

describe("getSignals return shape", () => {
  it("omits recipe/config and truncates description", async () => {
    const result = (await getSignals.execute!({}, {} as never)) as {
      signals: Array<Record<string, unknown>>;
    };
    const s = result.signals[0];
    expect(s).not.toHaveProperty("recipe");
    expect(s).not.toHaveProperty("config");
    expect(s).toMatchObject({
      id: "s1",
      name: "Hiring Surge",
      category: "hiring",
      is_builtin: true,
    });
  });
});
