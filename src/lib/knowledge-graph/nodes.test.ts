import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockSelectLimit,
  mockSelect,
  mockInsertReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn();
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  const mockInsertReturning = vi.fn();
  const mockInsertValues = vi
    .fn()
    .mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  return {
    mockSelectLimit,
    mockSelect,
    mockInsertReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
  };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: { select: mockSelect, insert: mockInsert, update: mockUpdate },
}));

import { insertKgEdge, invalidateEdges, upsertKgNode } from "./nodes";

describe("upsertKgNode", () => {
  beforeEach(() => {
    mockSelectLimit.mockReset();
    mockInsertReturning.mockReset();
    mockInsert.mockClear();
    mockInsertValues.mockClear();
    mockUpdateWhere.mockClear();
  });

  it("creates a new node when no existing ref match is found", async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([{ id: "node-1" }]);

    const result = await upsertKgNode({
      kind: "person",
      name: "Jane Doe",
      refTable: "people",
      refId: "p1",
    });

    expect(result).toEqual({ id: "node-1" });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "person", name: "Jane Doe" }),
    );
  });

  it("returns the existing node id when a ref match is found (no insert)", async () => {
    mockSelectLimit.mockResolvedValueOnce([
      { id: "node-existing", summary: "already set", attributes: {} },
    ]);

    const result = await upsertKgNode({
      kind: "person",
      name: "Jane Doe",
      refTable: "people",
      refId: "p1",
    });

    expect(result).toEqual({ id: "node-existing" });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("insertKgEdge", () => {
  it("inserts an edge row and returns its id", async () => {
    mockInsertReturning.mockResolvedValueOnce([{ id: "edge-1" }]);
    const result = await insertKgEdge({
      sourceId: "n1",
      targetId: "n2",
      relation: "research_hook",
      factText: "Acme raised $40M",
    });
    expect(result).toEqual({ id: "edge-1" });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "n1",
        targetId: "n2",
        relation: "research_hook",
        factText: "Acme raised $40M",
      }),
    );
  });
});

describe("invalidateEdges", () => {
  it("issues an update setting invalidAt", async () => {
    await invalidateEdges({ sourceId: "n1", relation: "works_at" });
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ invalidAt: expect.any(Date) }),
    );
  });
});
