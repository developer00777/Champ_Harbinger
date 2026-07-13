import { describe, expect, it, vi } from "vitest";

import { getSettings } from "../config";
import { makeContact } from "../types";
import type { Company, Person } from "@/lib/lakeb2b/schemas";
import { LakeB2BAdapter, pickBestMatch } from "./lakeb2bAdapter";

const settings = getSettings();

function person(overrides: Partial<Person>): Person {
  return {
    id: "p1",
    full_name: "Jane Doe",
    ...overrides,
  } as Person;
}

describe("pickBestMatch", () => {
  it("returns the exact full-name match", () => {
    const got = pickBestMatch(
      [person({ id: "a", full_name: "John Smith" }), person({ id: "b" })],
      { fullName: "Jane Doe", company: null, linkedinUrl: null },
    );
    expect(got?.id).toBe("b");
  });

  it("wins on LinkedIn URL when the seed carries one", () => {
    const got = pickBestMatch(
      [
        person({
          id: "a",
          full_name: "Jane Doe",
          linkedin_url: "https://linkedin.com/in/other-jane",
        }),
        person({
          id: "b",
          full_name: "Jane Doe",
          linkedin_url: "https://www.linkedin.com/in/jane-doe",
        }),
      ],
      {
        fullName: "Jane Doe",
        company: null,
        linkedinUrl: "https://linkedin.com/in/jane-doe/",
      },
    );
    expect(got?.id).toBe("b");
  });

  it("rejects a same-name stranger whose LinkedIn slug lacks the surname", () => {
    const got = pickBestMatch(
      [
        person({
          id: "a",
          full_name: "Jane Doe",
          linkedin_url: "https://www.linkedin.com/in/jane-williams",
        }),
      ],
      { fullName: "Jane Doe", company: null, linkedinUrl: null },
    );
    expect(got).toBeNull();
  });

  it("prefers the company-consistent candidate", () => {
    const got = pickBestMatch(
      [
        person({ id: "a", full_name: "Jane Doe", company_name: "OtherCo" }),
        person({ id: "b", full_name: "Jane Doe", company_name: "Acme Inc" }),
      ],
      { fullName: "Jane Doe", company: "Acme", linkedinUrl: null },
    );
    expect(got?.id).toBe("b");
  });

  it("returns null when nothing matches the seed name", () => {
    const got = pickBestMatch([person({ id: "a", full_name: "Bob Lee" })], {
      fullName: "Jane Doe",
      company: null,
      linkedinUrl: null,
    });
    expect(got).toBeNull();
  });
});

describe("LakeB2BAdapter.fetch", () => {
  it("maps a matched person + company into provenance-stamped fields", async () => {
    const lookup = vi.fn(async () => ({
      person: person({
        id: "p1",
        full_name: "Jane Doe",
        title: "VP Engineering",
        company_name: "Acme Inc",
        email: "jane@acme.com",
        linkedin_url: "https://linkedin.com/in/jane-doe",
        location: { country: "USA", state: "CA", city: "SF" },
      }),
      company: {
        id: "c1",
        name: "Acme Inc",
        industry: "SaaS",
        funding_stage: "Series B",
      } as Company,
    }));

    const adapter = new LakeB2BAdapter({
      lookup,
      isConfigured: async () => true,
    });
    const contact = makeContact({ fullName: "Jane Doe", company: "Acme" });
    const result = await adapter.fetch(contact, settings);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("lakeb2b");
    expect(result.fields.email?.value).toBe("jane@acme.com");
    expect(result.fields.email?.source).toBe("lakeb2b");
    expect(result.fields.email?.verified).toBe(false); // gate verifies downstream
    expect(result.fields.title?.value).toBe("VP Engineering");
    expect(result.fields.company?.value).toBe("Acme Inc");
    expect(result.fields.linkedin?.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(result.fields.linkedin?.verified).toBe(true);
    expect(result.firmographics.industry).toBe("SaaS");
    expect(result.firmographics.funding_stage).toBe("Series B");
    expect(result.firmographics.contact_location).toBeTruthy();
  });

  it("returns an empty (billable) result when there is no match", async () => {
    const adapter = new LakeB2BAdapter({
      lookup: async () => null,
      isConfigured: async () => true,
    });
    const contact = makeContact({ fullName: "Nobody Here" });
    const result = await adapter.fetch(contact, settings);
    expect(result.success).toBe(false);
    expect(Object.keys(result.fields)).toHaveLength(0);
  });
});
