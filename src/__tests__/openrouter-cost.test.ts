import { describe, it, expect } from "vitest";
import { extractGenerationCost } from "@/lib/services/openrouter-cost";

describe("extractGenerationCost", () => {
  it("reads cost + generation id from providerMetadata.openrouter.usage", () => {
    const result = {
      providerMetadata: { openrouter: { usage: { cost: 0.0123 } } },
      response: { id: "gen-abc123" },
    };
    expect(extractGenerationCost(result)).toEqual({
      generationId: "gen-abc123",
      realCostUsd: 0.0123,
    });
  });

  it("falls back to openrouter.cost when usage.cost is absent", () => {
    const result = {
      providerMetadata: { openrouter: { cost: 0.5 } },
      response: { id: "gen-x" },
    };
    expect(extractGenerationCost(result).realCostUsd).toBe(0.5);
  });

  it("prefers an explicit generationId in metadata over response.id", () => {
    const result = {
      providerMetadata: {
        openrouter: { generationId: "meta-id", usage: { cost: 1 } },
      },
      response: { id: "resp-id" },
    };
    expect(extractGenerationCost(result).generationId).toBe("meta-id");
  });

  it("returns undefined fields when no cost/metadata is present (graceful)", () => {
    expect(extractGenerationCost({})).toEqual({
      generationId: undefined,
      realCostUsd: undefined,
    });
    expect(extractGenerationCost({ response: { id: "only-id" } })).toEqual({
      generationId: "only-id",
      realCostUsd: undefined,
    });
  });

  it("ignores non-finite / non-numeric cost values", () => {
    const result = {
      providerMetadata: { openrouter: { usage: { cost: "not-a-number" } } },
    };
    expect(extractGenerationCost(result).realCostUsd).toBeUndefined();
  });
});
