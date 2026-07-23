import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockSelectLimit,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpsertKgNode,
  mockInsertKgEdge,
  mockInvalidateEdges,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn();
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpsertKgNode = vi.fn();
  const mockInsertKgEdge = vi.fn();
  const mockInvalidateEdges = vi.fn();
  return {
    mockSelectLimit,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpsertKgNode,
    mockInsertKgEdge,
    mockInvalidateEdges,
  };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockSelectLimit }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
  },
}));

vi.mock("./nodes", () => ({
  upsertKgNode: mockUpsertKgNode,
  insertKgEdge: mockInsertKgEdge,
  invalidateEdges: mockInvalidateEdges,
}));

import { processEpisode } from "./extract";

describe("processEpisode", () => {
  beforeEach(() => {
    mockSelectLimit.mockReset();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockUpsertKgNode.mockReset();
    mockInsertKgEdge.mockReset();
    mockInvalidateEdges.mockReset();
    mockUpsertKgNode.mockResolvedValue({ id: "node-x" });
    mockInsertKgEdge.mockResolvedValue({ id: "edge-x" });
  });

  it("no-ops when the episode does not exist", async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    const result = await processEpisode("missing");
    expect(result).toEqual({ factsWritten: 0 });
  });

  it("no-ops when the episode is already processed", async () => {
    mockSelectLimit.mockResolvedValueOnce([
      { id: "ep1", processedAt: new Date(), kind: "signal", content: {} },
    ]);
    const generateObject = vi.fn();
    const result = await processEpisode("ep1", { generateObject });
    expect(result).toEqual({ factsWritten: 0 });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("writes nodes+edges for each extracted fact and marks the episode processed", async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "ep2",
        processedAt: null,
        kind: "enrichment",
        refTable: "people",
        refId: "p1",
        content: { note: "Jane moved to Acme as CTO" },
      },
    ]);
    const generateObject = vi.fn(async () => ({
      object: {
        facts: [
          {
            subject: "Jane Doe",
            subjectKind: "person",
            relation: "works_at",
            target: "Acme Corp",
            targetKind: "organization",
            factText: "Jane Doe works at Acme Corp as CTO.",
            confidence: 0.9,
            exclusive: true,
          },
        ],
      },
    }));

    const result = await processEpisode("ep2", { generateObject });

    expect(result).toEqual({ factsWritten: 1 });
    expect(mockInvalidateEdges).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "node-x", relation: "works_at" }),
    );
    expect(mockInsertKgEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        relation: "works_at",
        factText: "Jane Doe works at Acme Corp as CTO.",
        episodeId: "ep2",
      }),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ error: null }),
    );
  });

  it("skips facts missing subject/target/factText", async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "ep3",
        processedAt: null,
        kind: "note",
        refTable: null,
        refId: null,
        content: {},
      },
    ]);
    const generateObject = vi.fn(async () => ({
      object: {
        facts: [
          {
            subject: "",
            subjectKind: "person",
            relation: "x",
            target: "Y",
            targetKind: "topic",
            factText: "",
          },
        ],
      },
    }));
    const result = await processEpisode("ep3", { generateObject });
    expect(result).toEqual({ factsWritten: 0 });
    expect(mockInsertKgEdge).not.toHaveBeenCalled();
  });

  it("records an error and still marks the episode processed when the LLM call throws", async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "ep4",
        processedAt: null,
        kind: "note",
        refTable: null,
        refId: null,
        content: {},
      },
    ]);
    const generateObject = vi.fn(async () => {
      throw new Error("provider down");
    });
    const result = await processEpisode("ep4", { generateObject });
    expect(result).toEqual({ factsWritten: 0 });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ error: "provider down" }),
    );
  });
});
