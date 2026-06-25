import { describe, it, expect } from "vitest";
import { normalizeTitle, scoreTitleMatch, bestTitleScore } from "./title-match";

describe("normalizeTitle", () => {
  it("extracts seniority + function", () => {
    expect(normalizeTitle("Head of Treasury")).toEqual({
      seniority: "head",
      functions: ["treasury"],
    });
    expect(normalizeTitle("VP, Engineering").seniority).toBe("vp");
    expect(normalizeTitle("CFO").seniority).toBe("c_level");
    expect(normalizeTitle("").seniority).toBe("unknown");
  });
});

describe("scoreTitleMatch — the spec example", () => {
  // "Head of Treasury", "Treasury Lead", "VP, Treasury" all satisfy a
  // "treasury decision maker" intent.
  const intent = "Treasury";
  it.each([["Head of Treasury"], ["Treasury Lead"], ["VP, Treasury"]])(
    "%s satisfies treasury intent",
    (title) => {
      expect(scoreTitleMatch(title, intent)).toBeGreaterThanOrEqual(0.7);
    },
  );

  it("rewards exact seniority match higher than distant", () => {
    const exact = scoreTitleMatch("VP Treasury", "VP Treasury");
    const distant = scoreTitleMatch("Treasury Analyst", "VP Treasury");
    expect(exact).toBeGreaterThan(distant);
    expect(exact).toBeGreaterThanOrEqual(0.99);
  });
});

describe("scoreTitleMatch — function gating", () => {
  it("rejects a different function family", () => {
    expect(scoreTitleMatch("VP Engineering", "VP Sales")).toBeLessThan(0.5);
    expect(
      scoreTitleMatch("Head of Marketing", "Head of Finance"),
    ).toBeLessThan(0.5);
  });

  it("matches finance synonyms", () => {
    expect(
      scoreTitleMatch("FP&A Director", "Finance Director"),
    ).toBeGreaterThanOrEqual(0.7);
    expect(
      scoreTitleMatch("Controller", "Head of Finance"),
    ).toBeGreaterThanOrEqual(0.7);
  });

  it("falls back to token overlap for unmapped titles, capped below the function band", () => {
    const s = scoreTitleMatch("Chief Vibes Officer", "Chief Vibes Officer");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0.6);
  });
});

describe("bestTitleScore", () => {
  it("takes the max over requested titles", () => {
    const score = bestTitleScore("Head of Treasury", [
      "VP Engineering",
      "Treasury Lead",
      "CMO",
    ]);
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it("returns 0 with no requested titles", () => {
    expect(bestTitleScore("CFO", [])).toBe(0);
  });
});
