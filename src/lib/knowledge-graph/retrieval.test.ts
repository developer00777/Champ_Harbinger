import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Chain-agnostic select mock: each `adminDb.select()` call returns a fresh
 * chain object whose from/where/orderBy all return itself and whose final
 * `.limit()` resolves to the next queued result. Tests queue results with
 * `queueSelect(rows)` in call order.
 */
const { mockSelect, queueSelect } = vi.hoisted(() => {
  const queue: unknown[][] = [];
  function queueSelect(rows: unknown[]) {
    queue.push(rows);
  }
  const mockSelect = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => Promise.resolve(queue.shift() ?? []);
    return chain;
  });
  return { mockSelect, queueSelect };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: { select: mockSelect },
}));

import { getOrganizationContext, getPersonContext } from "./retrieval";

describe("getPersonContext", () => {
  beforeEach(() => mockSelect.mockClear());

  it("returns an empty context when the person has no kg node yet", async () => {
    queueSelect([]); // findNode -> no match
    const result = await getPersonContext("p-none");
    expect(result).toEqual({ summary: "", facts: [], primaryHook: null });
  });

  it("surfaces facts and picks the research_hook edge as primaryHook", async () => {
    queueSelect([{ id: "node-1", summary: null }]); // findNode
    const now = new Date("2026-07-20T00:00:00Z");
    queueSelect([
      {
        factText: "Acme Corp raised $40M Series C.",
        relation: "research_hook",
        source: "https://news.example.com/a",
        validFrom: now,
      },
      {
        factText: "Works at Acme Corp.",
        relation: "works_at",
        source: "lakeb2b",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const result = await getPersonContext("p1");

    expect(result.facts).toEqual([
      "Acme Corp raised $40M Series C.",
      "Works at Acme Corp.",
    ]);
    expect(result.primaryHook).toEqual({
      fact: "Acme Corp raised $40M Series C.",
      sourceUrl: "https://news.example.com/a",
      capturedAt: now.toISOString(),
    });
  });

  it("omits sourceUrl when the hook edge's source is not a URL", async () => {
    queueSelect([{ id: "node-2", summary: null }]);
    const now = new Date("2026-07-20T00:00:00Z");
    queueSelect([
      {
        factText: "Spoke at SaaStr Annual 2026.",
        relation: "research_hook",
        source: "signal",
        validFrom: now,
      },
    ]);

    const result = await getPersonContext("p2");
    expect(result.primaryHook).toEqual({
      fact: "Spoke at SaaStr Annual 2026.",
      capturedAt: now.toISOString(),
    });
    expect(result.primaryHook).not.toHaveProperty("sourceUrl");
  });

  it("returns null primaryHook when there is no research_hook edge", async () => {
    queueSelect([{ id: "node-3", summary: "A summary." }]);
    queueSelect([
      {
        factText: "Works at Acme Corp.",
        relation: "works_at",
        source: "lakeb2b",
        validFrom: new Date(),
      },
    ]);
    const result = await getPersonContext("p3");
    expect(result.primaryHook).toBeNull();
    expect(result.summary).toBe("A summary.");
  });
});

describe("getOrganizationContext", () => {
  beforeEach(() => mockSelect.mockClear());

  it("returns empty context when the org has no kg node", async () => {
    queueSelect([]);
    const result = await getOrganizationContext("org-none");
    expect(result).toEqual({ summary: "", facts: [] });
  });

  it("returns facts for a known org", async () => {
    queueSelect([{ id: "node-org", summary: null }]);
    queueSelect([
      { factText: "Opened a Berlin office.", validFrom: new Date() },
    ]);
    const result = await getOrganizationContext("org1");
    expect(result.facts).toEqual(["Opened a Berlin office."]);
  });
});
