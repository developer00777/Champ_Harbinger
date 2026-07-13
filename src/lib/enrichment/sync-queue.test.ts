import { describe, expect, it } from "vitest";

import { planMasterSync } from "./sync-queue";

describe("planMasterSync", () => {
  it("syncs every staged row when no specific ids are requested", () => {
    expect(planMasterSync(["a", "b", "c"], null)).toEqual({
      toSync: ["a", "b", "c"],
      skipped: [],
    });
  });

  it("syncs only requested ids that are actually staged", () => {
    expect(planMasterSync(["a", "b"], ["a", "x"])).toEqual({
      toSync: ["a"],
      skipped: ["x"],
    });
  });

  it("skips a requested id that is not staged (already synced or foreign)", () => {
    expect(planMasterSync([], ["a"])).toEqual({ toSync: [], skipped: ["a"] });
  });

  it("dedupes repeated requested ids", () => {
    expect(planMasterSync(["a"], ["a", "a"])).toEqual({
      toSync: ["a"],
      skipped: [],
    });
  });
});
