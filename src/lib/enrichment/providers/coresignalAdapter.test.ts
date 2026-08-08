import { describe, expect, it, vi } from "vitest";

import { getSettings } from "../config";
import { makeContact } from "../types";
import { CoresignalAdapter, type CoresignalPerson } from "./coresignalAdapter";

const settings = getSettings();

function adapter(person: CoresignalPerson | null) {
  return new CoresignalAdapter({
    isConfigured: async () => true,
    lookup: vi.fn(async () => person),
  });
}

describe("CoresignalAdapter.fetch", () => {
  it("maps a Coresignal record into provenance-stamped fields + firmographics", async () => {
    const result = await adapter({
      full_name: "Jane Doe",
      active_experience_title: "VP of Engineering",
      active_experience_management_level: "vp",
      primary_professional_email: "jane@acme.com",
      professional_network_url: "linkedin.com/in/jane-doe",
      company_name: "Acme Inc",
      active_experience_company_website: "acme.com",
      company_industry: "computer software",
      location_full: "San Francisco, California, United States",
    }).fetch(makeContact({ fullName: "Jane Doe", company: "Acme" }), settings);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("coresignal");
    expect(result.fields.email?.value).toBe("jane@acme.com");
    expect(result.fields.email?.verified).toBe(false);
    expect(result.fields.title?.value).toBe("VP of Engineering");
    expect(result.fields.seniority?.value).toBe("vp");
    expect(result.fields.company?.value).toBe("Acme Inc");
    // bare linkedin host is normalized to canonical https form
    expect(result.fields.linkedin?.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(result.firmographics.industry).toBe("computer software");
    expect(result.firmographics.company_domain).toBe("acme.com");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("falls back to headline when active_experience_title is absent", async () => {
    const result = await adapter({
      headline: "CTO at Acme",
      professional_emails_collection: [{ email: "jane@work.com" }],
    }).fetch(makeContact({ fullName: "Jane Doe" }), settings);
    expect(result.fields.title?.value).toBe("CTO at Acme");
    expect(result.fields.email?.value).toBe("jane@work.com");
  });

  it("no-match is free (costUsd 0) and unsuccessful", async () => {
    const result = await adapter(null).fetch(
      makeContact({ fullName: "Nobody" }),
      settings,
    );
    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0);
  });

  it("is disabled when no key is configured", async () => {
    const noKey = new CoresignalAdapter({
      isConfigured: async () => false,
    });
    expect(await noKey.isEnabled(settings)).toBe(false);
  });

  it("a failed lookup returns an empty result, not a thrown error", async () => {
    const failing = new CoresignalAdapter({
      isConfigured: async () => true,
      lookup: vi.fn(async () => {
        throw new Error("Coresignal 500");
      }),
    });
    const result = await failing.fetch(
      makeContact({ fullName: "Jane Doe" }),
      settings,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Coresignal 500");
  });
});
