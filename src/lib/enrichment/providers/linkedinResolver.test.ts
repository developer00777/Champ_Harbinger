import { describe, expect, it, vi } from "vitest";

import {
  linkedinUrlMatchesSeed,
  normalizeLinkedInUrl,
  resolveLinkedInUrl,
} from "./linkedinResolver";

describe("normalizeLinkedInUrl", () => {
  it("canonicalizes various forms to https://www.linkedin.com/in/<slug>", () => {
    expect(normalizeLinkedInUrl("linkedin.com/in/jane-doe/")).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(
      normalizeLinkedInUrl("https://uk.linkedin.com/in/jane-doe?trk=abc"),
    ).toBe("https://www.linkedin.com/in/jane-doe");
    expect(normalizeLinkedInUrl("not a url")).toBeNull();
  });
});

describe("resolveLinkedInUrl", () => {
  it("returns the seed URL (normalized) when one is already present", async () => {
    const search = vi.fn();
    const url = await resolveLinkedInUrl(
      { fullName: "Jane Doe", linkedinUrl: "linkedin.com/in/jane-doe" },
      { search },
    );
    expect(url).toBe("https://www.linkedin.com/in/jane-doe");
    expect(search).not.toHaveBeenCalled();
  });

  it("searches and picks the first /in/ profile result", async () => {
    const search = vi.fn(async () => [
      { url: "https://acme.com/team", title: "Team" },
      {
        url: "https://www.linkedin.com/in/jane-doe",
        title: "Jane Doe - VP at Acme",
      },
    ]);
    const url = await resolveLinkedInUrl(
      { fullName: "Jane Doe", company: "Acme", domain: "acme.com" },
      { search },
    );
    expect(url).toBe("https://www.linkedin.com/in/jane-doe");
    expect(search).toHaveBeenCalledOnce();
  });

  it("returns null when nothing is found and no name to search", async () => {
    const search = vi.fn(async () => []);
    expect(
      await resolveLinkedInUrl({ domain: "acme.com" }, { search }),
    ).toBeNull();
  });
});

describe("linkedinUrlMatchesSeed", () => {
  it("matches when the slug contains the surname", () => {
    expect(
      linkedinUrlMatchesSeed("https://www.linkedin.com/in/jane-doe", {
        fullName: "Jane Doe",
      }),
    ).toBe(true);
  });
  it("does not match an unrelated slug", () => {
    expect(
      linkedinUrlMatchesSeed("https://www.linkedin.com/in/bob-smith", {
        fullName: "Jane Doe",
      }),
    ).toBe(false);
  });
});
