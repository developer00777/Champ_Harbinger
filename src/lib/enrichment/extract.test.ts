import { describe, expect, it, vi } from "vitest";

import { getSettings } from "./config";
import { extractContactFields } from "./extract";

const settings = getSettings();

describe("extractContactFields", () => {
  it("maps LLM output to provenance-stamped FieldValues + firmographics", async () => {
    const generateObject = vi.fn(async () => ({
      object: {
        email: "jane@acme.com",
        title: "VP Engineering",
        seniority: "VP",
        linkedin: "https://linkedin.com/in/jane",
        phone: null,
        recentPosts: ["Shipped our Series B!", "Hiring 10 engineers"],
        firmographics: {
          company_name: "Acme",
          industry: "SaaS",
          funding_stage: "Series B",
        },
      },
    }));

    const res = await extractContactFields(
      {
        scrapedText: "Jane is VP Engineering at Acme...",
        seed: { fullName: "Jane", domain: "acme.com" },
      },
      settings,
      { generateObject },
    );

    expect(generateObject).toHaveBeenCalledOnce();
    expect(res.fields.title.value).toBe("VP Engineering");
    expect(res.fields.title.source).toBe("owned_scrape");
    expect(res.fields.email.value).toBe("jane@acme.com");
    // Email is unverified here; the email gate verifies it downstream.
    expect(res.fields.email.verified).toBe(false);
    expect(res.fields.linkedin.value).toBe("https://linkedin.com/in/jane");
    expect(res.firmographics.funding_stage).toBe("Series B");
    expect(res.firmographics.recent_posts).toEqual([
      "Shipped our Series B!",
      "Hiring 10 engineers",
    ]);
  });

  it("omits empty/null fields and tolerates a sparse model response", async () => {
    const generateObject = vi.fn(async () => ({
      object: { title: "Founder", email: null, firmographics: null },
    }));
    const res = await extractContactFields(
      { scrapedText: "...", seed: { fullName: "Sam" } },
      settings,
      { generateObject },
    );
    expect(res.fields.title.value).toBe("Founder");
    expect(res.fields.email).toBeUndefined();
    expect(Object.keys(res.firmographics)).toHaveLength(0);
  });

  it("returns empty result without calling the model when there is no scraped text", async () => {
    const generateObject = vi.fn();
    const res = await extractContactFields(
      { scrapedText: "", seed: { fullName: "Nobody" } },
      settings,
      { generateObject },
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(Object.keys(res.fields)).toHaveLength(0);
  });
});
