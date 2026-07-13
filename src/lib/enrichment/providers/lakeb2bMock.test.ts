import { describe, expect, it } from "vitest";

import { getSettings } from "../config";
import { makeContact, Tier } from "../types";
import { MockLakeB2BAdapter } from "./lakeb2bMock";

const settings = getSettings();

function contact(seed: Parameters<typeof makeContact>[0]) {
  return makeContact(seed);
}

describe("MockLakeB2BAdapter", () => {
  it("identifies as the pinned lakeb2b primary at the T0 master tier", () => {
    const a = new MockLakeB2BAdapter();
    expect(a.name).toBe("lakeb2b");
    expect(a.tier).toBe(Tier.T0Master);
    expect(a.costPerCall).toBe(0);
  });

  it("is disabled unless the mock flag is on", () => {
    expect(new MockLakeB2BAdapter({ enabled: false }).isEnabled()).toBe(false);
    expect(new MockLakeB2BAdapter({ enabled: true }).isEnabled()).toBe(true);
  });

  it("canSupply is true for standard fields, false for ones it cannot fill", () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    expect(a.canSupply(["email"])).toBe(true);
    expect(a.canSupply(["title", "unknown_field"])).toBe(true);
    expect(a.canSupply(["unknown_field"])).toBe(false);
  });

  it("derives a deterministic work email from name + domain, stamped with lakeb2b provenance", async () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    const c = contact({ fullName: "Jane Doe", domain: "acme.com" });
    const r = await a.fetch(c, settings);
    expect(r.provider).toBe("lakeb2b");
    expect(r.tier).toBe(Tier.T0Master);
    expect(r.success).toBe(true);
    expect(r.fields.email?.value).toBe("jane.doe@acme.com");
    expect(r.fields.email?.source).toBe("lakeb2b");
    expect(r.fields.linkedin?.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
  });

  it("is deterministic: the same identity yields the same record", async () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    const c1 = contact({ fullName: "Jane Doe", domain: "acme.com" });
    const c2 = contact({ fullName: "Jane Doe", domain: "acme.com" });
    const r1 = await a.fetch(c1, settings);
    const r2 = await a.fetch(c2, settings);
    expect(r1.fields.phone?.value).toBe(r2.fields.phone?.value);
    expect(r1.fields.title?.value).toBe(r2.fields.title?.value);
    expect(r1.fields.seniority?.value).toBe(r2.fields.seniority?.value);
  });

  it("normalizes a messy domain when building the email", async () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    const c = contact({
      fullName: "John Q. Smith",
      domain: "https://www.Acme.com/careers",
    });
    const r = await a.fetch(c, settings);
    expect(r.fields.email?.value).toBe("john.smith@acme.com");
  });

  it("returns an empty (no-field) result when there is no identity to work from", async () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    const c = contact({});
    const r = await a.fetch(c, settings);
    expect(r.success).toBe(false);
    expect(Object.keys(r.fields)).toHaveLength(0);
  });

  it("only ever sends minimal identifiers (no full Contact leakage)", async () => {
    const a = new MockLakeB2BAdapter({ enabled: true });
    const c = contact({ fullName: "Jane Doe", domain: "acme.com" });
    const r = await a.fetch(c, settings);
    const allowed = new Set([
      "email",
      "fullName",
      "company",
      "domain",
      "linkedinUrl",
    ]);
    for (const key of Object.keys(r.requestIdentifiers)) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});
