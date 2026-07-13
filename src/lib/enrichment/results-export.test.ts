import { describe, expect, it } from "vitest";

import {
  buildProvenanceCsv,
  PROVENANCE_FIELDS,
  type ResultRecord,
} from "./results-export";

const base: ResultRecord = {
  name: "Jane Doe",
  company: "Acme",
  domain: "acme.com",
  status: "accepted",
  completenessScore: 1,
  confidenceScore: 0.91,
  fields: {
    email: {
      value: "jane.doe@acme.com",
      source: "lakeb2b",
      confidence: 0.9,
      verified: true,
    },
    title: {
      value: "CFO",
      source: "owned_scrape",
      confidence: 0.7,
      verified: false,
    },
  },
};

describe("buildProvenanceCsv", () => {
  it("emits a header with value/source/confidence/verified columns per field", () => {
    const csv = buildProvenanceCsv([base]);
    const header = csv.split("\n")[0];
    for (const f of PROVENANCE_FIELDS) {
      expect(header).toContain(
        `${f},${f}_source,${f}_confidence,${f}_verified`,
      );
    }
    expect(
      header.startsWith("name,company,domain,status,completeness,confidence,"),
    ).toBe(true);
  });

  it("writes each field's value alongside its provenance", () => {
    const csv = buildProvenanceCsv([base]);
    const row = csv.split("\n")[1];
    expect(row).toContain("jane.doe@acme.com,lakeb2b,0.9,true");
    expect(row).toContain("CFO,owned_scrape,0.7,false");
  });

  it("leaves empty cells for fields a contact does not have", () => {
    const record: ResultRecord = { ...base, fields: {} };
    const csv = buildProvenanceCsv([record]);
    const row = csv.split("\n")[1];
    // email present as empty value + empty provenance triple
    expect(row).toContain("accepted,1,0.91,,,,");
  });

  it("escapes commas and quotes per RFC 4180", () => {
    const record: ResultRecord = {
      ...base,
      name: 'Doe, Jane "JD"',
      company: "Acme, Inc",
      fields: {},
    };
    const csv = buildProvenanceCsv([record]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"Doe, Jane ""JD""","Acme, Inc"');
  });

  it("produces a header plus one row per record", () => {
    const csv = buildProvenanceCsv([base, { ...base, name: "John" }]);
    expect(csv.trim().split("\n")).toHaveLength(3);
  });
});
