import { describe, expect, it } from "vitest";

import { canonicalRequiredFields } from "./required-fields";
import { DEFAULT_REQUIRED_FIELDS } from "./orchestrator";

describe("canonicalRequiredFields", () => {
  it("maps upload completeness options to waterfall canonical fields", () => {
    expect(canonicalRequiredFields(["work_email", "linkedin"])).toEqual([
      "email",
      "linkedin",
    ]);
    expect(canonicalRequiredFields(["direct_dial", "seniority"])).toEqual([
      "phone",
      "seniority",
    ]);
  });

  it("dedupes repeated options", () => {
    expect(canonicalRequiredFields(["work_email", "work_email"])).toEqual([
      "email",
    ]);
  });

  it("falls back to the default required set when nothing maps", () => {
    expect(canonicalRequiredFields([])).toEqual(DEFAULT_REQUIRED_FIELDS);
    expect(canonicalRequiredFields(["totally_unknown"])).toEqual(
      DEFAULT_REQUIRED_FIELDS,
    );
  });

  it("ignores unknown options but keeps the known ones", () => {
    expect(canonicalRequiredFields(["work_email", "totally_unknown"])).toEqual([
      "email",
    ]);
  });
});
