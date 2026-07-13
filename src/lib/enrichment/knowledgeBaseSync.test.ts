import { describe, expect, it } from "vitest";

import { getSettings } from "./config";
import { buildFieldValue } from "./confidence";
import { buildPersonEnrichment } from "./knowledgeBaseSync";
import { makeContact, type Contact } from "./types";

const settings = getSettings();

function fv(value: unknown, provider: string, verified = false) {
  return buildFieldValue({ value, provider, settings, verified });
}

describe("buildPersonEnrichment — additive source namespacing", () => {
  it("keeps LakeB2B and LinkedIn contributions in separate subtrees", () => {
    const contact: Contact = makeContact({
      fullName: "Jane Doe",
      company: "Acme",
      fields: {
        email: fv("jane@acme.com", "lakeb2b"),
        title: fv("VP Engineering", "lakeb2b"),
        linkedin: fv("https://www.linkedin.com/in/jane-doe", "owned_scrape"),
      },
      firmographics: {
        industry: "SaaS",
        contact_location: { city: "SF" },
        personalization: { about: "Builds platforms", location: "SF" },
        recent_posts: ["Shipped v2"],
      },
    });

    const payload = buildPersonEnrichment(contact) as Record<
      string,
      Record<string, unknown>
    >;

    // Both sources present, each under its own top-level key.
    expect(payload.lakeb2b).toBeTruthy();
    expect(payload.linkedin).toBeTruthy();
    expect((payload.lakeb2b.fields as Record<string, unknown>).email).toBe(
      "jane@acme.com",
    );
    expect(payload.lakeb2b.contact_location).toEqual({ city: "SF" });
    expect(payload.linkedin.personalization).toEqual({
      about: "Builds platforms",
      location: "SF",
    });
    expect(payload.linkedin.recent_posts).toEqual(["Shipped v2"]);

    // Merged provenance map records the source of every field.
    const prov = payload.provenance as Record<string, { source: string }>;
    expect(prov.email.source).toBe("lakeb2b");
    expect(prov.linkedin.source).toBe("owned_scrape");

    // enrichedAt is written so isRecentlyEnriched works for people.
    expect(typeof payload.enrichedAt).toBe("string");
  });

  it("omits a source's subtree when that source did not contribute (no clobber)", () => {
    // A LinkedIn-only run must NOT emit a lakeb2b key — so merging it into an
    // existing record leaves any prior enrichment_data.lakeb2b untouched.
    const contact: Contact = makeContact({
      fullName: "Jane Doe",
      fields: {
        linkedin: fv("https://www.linkedin.com/in/jane-doe", "owned_scrape"),
      },
      firmographics: {
        personalization: { about: "Builds platforms" },
      },
    });

    const payload = buildPersonEnrichment(contact);
    expect(payload.lakeb2b).toBeUndefined();
    expect(payload.linkedin).toBeTruthy();
  });
});
