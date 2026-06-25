import { describe, it, expect } from "vitest";
import {
  autoDetectMapping,
  applyMapping,
  missingRequiredFields,
  normalizeDomainLite,
  splitTitles,
  fieldDefs,
} from "./csv-mapping";

describe("normalizeDomainLite", () => {
  it("strips scheme, www, path", () => {
    expect(normalizeDomainLite("https://www.Acme.com/team")).toBe("acme.com");
    expect(normalizeDomainLite("  HTTP://Foo.IO ")).toBe("foo.io");
  });
});

describe("splitTitles", () => {
  it("splits on comma / semicolon / pipe / slash", () => {
    expect(
      splitTitles("CFO, VP Finance; Head of Treasury | Treasurer"),
    ).toEqual(["CFO", "VP Finance", "Head of Treasury", "Treasurer"]);
    expect(splitTitles("  ")).toEqual([]);
  });
});

describe("autoDetectMapping — companies", () => {
  it("maps common headers and target titles", () => {
    const headers = ["Company Name", "Website", "Target Titles", "Sector"];
    const m = autoDetectMapping(headers, "companies");
    expect(m).toEqual(["name", "domain", "targetTitles", "industry"]);
  });

  it("falls back to the first column for the company name", () => {
    const headers = ["Acct", "Notes"];
    const m = autoDetectMapping(headers, "companies");
    expect(m[0]).toBe("name");
  });

  it("claims each field at most once", () => {
    const headers = ["Company", "Organization"]; // both alias to name
    const m = autoDetectMapping(headers, "companies");
    expect(m.filter((f) => f === "name")).toHaveLength(1);
  });
});

describe("autoDetectMapping — contacts", () => {
  it("maps name/company/title/email/linkedin", () => {
    const headers = [
      "Full Name",
      "Company",
      "Job Title",
      "Work Email",
      "LinkedIn URL",
    ];
    const m = autoDetectMapping(headers, "contacts");
    expect(m).toEqual(["personName", "company", "title", "email", "linkedin"]);
  });
});

describe("missingRequiredFields", () => {
  it("reports the unmapped required key field", () => {
    expect(missingRequiredFields([null, "domain"], "companies")).toEqual([
      "name",
    ]);
    expect(
      missingRequiredFields(["name", "targetTitles"], "companies"),
    ).toEqual([]);
  });

  it("contacts require both name and company", () => {
    expect(missingRequiredFields(["personName"], "contacts")).toEqual([
      "company",
    ]);
  });
});

describe("applyMapping — companies", () => {
  const headers = ["Company", "Website", "Target Titles"];
  const mapping = autoDetectMapping(headers, "companies");

  it("parses rows, normalizes domains, splits titles", () => {
    const rows = [
      ["Acme Inc", "https://www.acme.com", "CFO, VP Finance"],
      ["Globex", "globex.io", "CTO"],
    ];
    const r = applyMapping(headers, rows, mapping, "companies");
    expect(r.companies).toHaveLength(2);
    expect(r.companies[0]).toMatchObject({
      name: "Acme Inc",
      domain: "acme.com",
      targetTitles: ["CFO", "VP Finance"],
    });
    expect(r.companies[1].domain).toBe("globex.io");
  });

  it("dedupes by domain and skips blank companies", () => {
    const rows = [
      ["Acme", "acme.com", ""],
      ["Acme Duplicate", "https://acme.com", ""], // same domain
      ["", "ghost.com", ""], // blank name
    ];
    const r = applyMapping(headers, rows, mapping, "companies");
    expect(r.companies).toHaveLength(1);
    expect(r.duplicates).toBe(1);
    expect(r.skipped).toBe(1);
  });
});

describe("applyMapping — contacts", () => {
  const headers = ["Name", "Company", "Title", "Email"];
  const mapping = autoDetectMapping(headers, "contacts");

  it("parses people and requires name + company", () => {
    const rows = [
      ["Jane Doe", "Acme", "CFO", "jane@acme.com"],
      ["No Company", "", "VP", "x@y.com"], // missing company → skipped
    ];
    const r = applyMapping(headers, rows, mapping, "contacts");
    expect(r.contacts).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.contacts[0]).toMatchObject({
      name: "Jane Doe",
      company: "Acme",
      title: "CFO",
      email: "jane@acme.com",
    });
  });

  it("dedupes by email", () => {
    const rows = [
      ["Jane Doe", "Acme", "CFO", "jane@acme.com"],
      ["J. Doe", "Acme Corp", "Finance", "jane@acme.com"], // same email
    ];
    const r = applyMapping(headers, rows, mapping, "contacts");
    expect(r.contacts).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });
});

describe("user-overridden mapping is honored", () => {
  it("uses the rep's manual field choice, not the auto-detect", () => {
    const headers = ["Col A", "Col B"];
    // Rep manually says Col B is the company name, Col A is the domain.
    const mapping = ["domain", "name"] as const;
    const rows = [["acme.com", "Acme"]];
    const r = applyMapping(headers, rows, [...mapping], "companies");
    expect(r.companies[0]).toMatchObject({ name: "Acme", domain: "acme.com" });
  });
});

describe("fieldDefs", () => {
  it("exposes a required key field per shape", () => {
    expect(fieldDefs("companies").find((f) => f.required)?.field).toBe("name");
    expect(
      fieldDefs("contacts")
        .filter((f) => f.required)
        .map((f) => f.field),
    ).toEqual(["personName", "company"]);
  });
});
