import { describe, expect, it, vi } from "vitest";

import { getSettings } from "../config";
import { makeContact } from "../types";
import { PeopleDataLabsAdapter, type PdlPerson } from "./peopleDataLabsAdapter";

const settings = getSettings();

function adapter(person: PdlPerson | null) {
  return new PeopleDataLabsAdapter({
    isConfigured: async () => true,
    lookup: vi.fn(async () => person),
  });
}

describe("PeopleDataLabsAdapter.fetch", () => {
  it("maps a PDL record into provenance-stamped fields + firmographics", async () => {
    const result = await adapter({
      full_name: "Jane Doe",
      job_title: "VP of Engineering",
      job_title_levels: ["vp"],
      work_email: "jane@acme.com",
      linkedin_url: "linkedin.com/in/jane-doe",
      job_company_name: "Acme Inc",
      job_company_website: "acme.com",
      job_company_industry: "computer software",
      location_name: "san francisco, california",
    }).fetch(makeContact({ fullName: "Jane Doe", company: "Acme" }), settings);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("pdl");
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

  it("falls back to the emails[] array when work_email is absent", async () => {
    const result = await adapter({
      job_title: "CTO",
      emails: [
        { address: "personal@gmail.com", type: "personal" },
        { address: "jane@work.com", type: "professional" },
      ],
    }).fetch(makeContact({ fullName: "Jane Doe" }), settings);
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
    const noKey = new PeopleDataLabsAdapter({
      isConfigured: async () => false,
    });
    expect(await noKey.isEnabled(settings)).toBe(false);
  });
});
