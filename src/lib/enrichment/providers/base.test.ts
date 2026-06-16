import { describe, expect, it } from "vitest";

import { getSettings } from "../config";
import { emptyResult, Tier, type ProviderResult } from "../types";
import { CircuitBreaker, ProviderRegistry, type ProviderAdapter } from "./base";

const settings = getSettings();

class FakeAdapter implements ProviderAdapter {
  constructor(
    readonly tier: Tier,
    readonly name: string,
    readonly costPerCall: number,
    private readonly coversFields: string[],
  ) {}
  canSupply(required: string[]): boolean {
    return required.some((f) => this.coversFields.includes(f));
  }
  isEnabled(): boolean {
    return true;
  }
  async fetch(): Promise<ProviderResult> {
    return emptyResult(this.name, this.tier);
  }
}

describe("CircuitBreaker", () => {
  it("opens after threshold consecutive failures and blocks calls", () => {
    const t = 0;
    const b = new CircuitBreaker(3, 1000, () => t);
    expect(b.allow()).toBe(true);
    b.recordFailure();
    b.recordFailure();
    expect(b.allow()).toBe(true);
    b.recordFailure(); // 3rd -> open
    expect(b.state).toBe("open");
    expect(b.allow()).toBe(false);
  });

  it("transitions to half_open after cooldown, then closes on success", () => {
    let t = 0;
    const b = new CircuitBreaker(1, 1000, () => t);
    b.recordFailure(); // open immediately (threshold 1)
    expect(b.allow()).toBe(false);
    t = 1000; // cooldown elapsed
    expect(b.state).toBe("half_open");
    expect(b.allow()).toBe(true);
    b.recordSuccess();
    expect(b.state).toBe("closed");
  });
});

describe("ProviderRegistry.orderedFor", () => {
  it("returns enabled adapters covering a missing field, in priority rank order", () => {
    const reg = new ProviderRegistry(settings);
    // owned_scrape (rank 10) and proxycurl (rank 20) both cover 'title'.
    reg.register(
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, ["title", "email"]),
    );
    reg.register(
      new FakeAdapter(Tier.T2Person, "proxycurl", 0.03, ["title", "linkedin"]),
    );
    const ordered = reg.orderedFor(["title"]).map((a) => a.name);
    expect(ordered).toEqual(["owned_scrape", "proxycurl"]);
  });

  it("excludes adapters whose priority-list coverage does not intersect the missing fields", () => {
    const reg = new ProviderRegistry(settings);
    // Coverage is driven by the priority config: owned_scrape covers 'linkedin',
    // zoominfo (per default config) does NOT, so only owned_scrape is returned.
    reg.register(
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, ["linkedin"]),
    );
    reg.register(new FakeAdapter(Tier.T3Heavy, "zoominfo", 0.25, ["linkedin"]));
    const ordered = reg.orderedFor(["linkedin"]).map((a) => a.name);
    expect(ordered).toEqual(["owned_scrape"]);
  });

  it("never includes lakeb2b in the priority escalation (it is the pinned primary)", () => {
    const reg = new ProviderRegistry(settings);
    reg.register(
      new FakeAdapter(Tier.T0Master, "lakeb2b", 0, ["email", "title"]),
    );
    reg.register(
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, ["email"]),
    );
    const ordered = reg.orderedFor(["email"]).map((a) => a.name);
    expect(ordered).not.toContain("lakeb2b");
  });
});
