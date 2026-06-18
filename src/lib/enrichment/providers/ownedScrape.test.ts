import { describe, expect, it, vi } from "vitest";

import { getSettings } from "../config";
import { buildFieldValue } from "../confidence";
import { makeContact, Tier } from "../types";
import { OwnedScrapeAdapter } from "./ownedScrape";

const settings = getSettings();

describe("OwnedScrapeAdapter", () => {
  it("scrapes a domain, resolves LinkedIn, and returns extracted fields at $0", async () => {
    const webExtract = vi.fn(async () => ({
      success: true,
      url: "https://acme.com",
      source: "fetch" as const,
      data: {
        title: "Acme",
        description: "We do SaaS",
        content: "Jane Doe, VP Engineering. Contact jane@acme.com",
        contactInfo: { emails: ["jane@acme.com"], phones: [] },
      },
      extractionTime: 5,
    }));
    const resolveLinkedIn = vi.fn(
      async () => "https://www.linkedin.com/in/jane-doe",
    );
    const extract = vi.fn(async () => ({
      fields: {
        title: buildFieldValue({
          value: "VP Engineering",
          provider: "owned_scrape",
          settings,
        }),
        email: buildFieldValue({
          value: "jane@acme.com",
          provider: "owned_scrape",
          settings,
          verified: false,
        }),
      },
      firmographics: { company_name: "Acme", funding_stage: "Series B" },
    }));

    const adapter = new OwnedScrapeAdapter({
      webExtract,
      resolveLinkedIn,
      extract,
    });
    const contact = makeContact({ fullName: "Jane Doe", domain: "acme.com" });
    const result = await adapter.fetch(contact, settings);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("owned_scrape");
    expect(result.tier).toBe(Tier.T1Lakestream);
    expect(result.costUsd).toBe(0);
    expect(result.fields.title.value).toBe("VP Engineering");
    expect(result.fields.linkedin.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(result.firmographics.funding_stage).toBe("Series B");
    expect(webExtract).toHaveBeenCalled();
  });

  it("returns an empty result when there is nothing to scrape", async () => {
    const resolveLinkedIn = vi.fn(async () => null);
    const extract = vi.fn(async () => ({ fields: {}, firmographics: {} }));
    const adapter = new OwnedScrapeAdapter({
      webExtract: vi.fn(),
      resolveLinkedIn,
      extract,
    });
    // No domain, no linkedin -> nothing to scrape.
    const contact = makeContact({ fullName: "Nobody" });
    const result = await adapter.fetch(contact, settings);
    expect(result.success).toBe(false);
  });

  it("is always enabled (owned, degrades gracefully) and supplies contact fields", () => {
    const adapter = new OwnedScrapeAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.canSupply(["email", "title"])).toBe(true);
    expect(adapter.canSupply(["unrelated_field"])).toBe(false);
  });
});
