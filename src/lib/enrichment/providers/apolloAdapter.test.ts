import { describe, expect, it, vi } from "vitest";

import { getSettings } from "../config";
import { makeContact } from "../types";
import { ApolloAdapter, type ApolloPerson } from "./apolloAdapter";

const settings = getSettings();

function adapter(person: ApolloPerson | null) {
  return new ApolloAdapter({
    isConfigured: async () => true,
    lookup: vi.fn(async () => person),
  });
}

describe("ApolloAdapter.fetch", () => {
  it("maps an Apollo person into provenance-stamped fields + firmographics", async () => {
    const result = await adapter({
      first_name: "Jane",
      last_name: "Doe",
      title: "VP Engineering",
      seniority: "vp",
      email: "jane@acme.com",
      linkedin_url: "https://linkedin.com/in/jane-doe",
      city: "San Francisco",
      state: "CA",
      country: "USA",
      organization: {
        name: "Acme Inc",
        primary_domain: "acme.com",
        industry: "software",
      },
    }).fetch(makeContact({ fullName: "Jane Doe", company: "Acme" }), settings);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("apollo");
    expect(result.fields.email?.value).toBe("jane@acme.com");
    expect(result.fields.email?.source).toBe("apollo");
    expect(result.fields.email?.verified).toBe(false);
    expect(result.fields.title?.value).toBe("VP Engineering");
    expect(result.fields.seniority?.value).toBe("vp");
    expect(result.fields.company?.value).toBe("Acme Inc");
    expect(result.fields.linkedin?.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(result.firmographics.industry).toBe("software");
    expect(result.firmographics.company_domain).toBe("acme.com");
    expect(result.firmographics.contact_location).toBe(
      "San Francisco, CA, USA",
    );
    expect(result.costUsd).toBeGreaterThan(0); // a returned record is billed
  });

  it("drops Apollo's locked-email placeholder", async () => {
    const result = await adapter({
      title: "CTO",
      email: "email_not_unlocked@domain.com",
    }).fetch(makeContact({ fullName: "Jane Doe" }), settings);
    expect(result.fields.email).toBeUndefined();
    expect(result.fields.title?.value).toBe("CTO");
  });

  it("no-match is free (costUsd 0) and unsuccessful", async () => {
    const result = await adapter(null).fetch(
      makeContact({ fullName: "Nobody" }),
      settings,
    );
    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0);
  });

  it("a lookup error is caught, never throws, and is free", async () => {
    const errAdapter = new ApolloAdapter({
      isConfigured: async () => true,
      lookup: async () => {
        throw new Error("Apollo 429");
      },
    });
    const result = await errAdapter.fetch(
      makeContact({ fullName: "Jane Doe" }),
      settings,
    );
    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0);
    expect(result.error).toContain("apollo_lookup");
  });

  it("is disabled when no key is configured", async () => {
    const noKey = new ApolloAdapter({ isConfigured: async () => false });
    expect(await noKey.isEnabled(settings)).toBe(false);
  });
});
