import { describe, expect, it, vi } from "vitest";

import {
  applyPattern,
  emailMatchesName,
  inferPattern,
  isRolePrefix,
  KNOWN_PATTERNS,
  mxCheck,
  recordBounce,
  recordVerifiedEmail,
  splitName,
  type EmailSource,
  type EmailPatternDbAdapter,
  type PersonRow,
  type OrgRow,
} from "@/lib/services/email-pattern";

// ─── Fake Db adapter ──────────────────────────────────────────────────────────
//
// Minimal in-memory stub of the EmailPatternDbAdapter interface used by
// recordVerifiedEmail / recordBounce / recomputeOrgPattern.

function createFakeDb(initial: {
  people?: Partial<PersonRow>[];
  organizations?: Partial<OrgRow>[];
}): { adapter: EmailPatternDbAdapter; tables: { people: PersonRow[]; organizations: OrgRow[] } } {
  const tables = {
    people: (initial.people ?? []).map((p) => ({
      id: "",
      name: "",
      organization_id: null,
      work_email: null,
      work_email_source: null,
      work_email_confidence: null,
      work_email_verified_at: null,
      ...p,
    })) as PersonRow[],
    organizations: (initial.organizations ?? []).map((o) => ({
      id: "",
      email_pattern: null,
      email_pattern_confidence: null,
      email_pattern_evidence_count: 0,
      email_pattern_bounce_count: 0,
      email_pattern_updated_at: null,
      ...o,
    })) as OrgRow[],
  };

  const adapter: EmailPatternDbAdapter = {
    async getPeopleForOrg(orgId) {
      return tables.people.filter(
        (p) =>
          p.organization_id === orgId &&
          p.work_email !== null &&
          p.work_email_verified_at !== null,
      );
    },
    async getPerson(personId) {
      return tables.people.find((p) => p.id === personId) ?? null;
    },
    async updatePerson(personId, updates) {
      const p = tables.people.find((p) => p.id === personId);
      if (p) Object.assign(p, updates);
    },
    async getOrg(orgId) {
      return tables.organizations.find((o) => o.id === orgId) ?? null;
    },
    async updateOrg(orgId, updates) {
      const o = tables.organizations.find((o) => o.id === orgId);
      if (o) Object.assign(o, updates);
    },
  };

  return { adapter, tables };
}

// ─── splitName ────────────────────────────────────────────────────────────

describe("splitName", () => {
  it("splits a normal two-word name", () => {
    expect(splitName("Jane Doe")).toEqual({ first: "jane", last: "doe" });
  });
  it("returns last as null for a single-word name", () => {
    expect(splitName("Madonna")).toEqual({ first: "madonna", last: null });
  });
  it("treats the last whitespace-separated token as the last name", () => {
    expect(splitName("Mary Jane Watson")).toEqual({
      first: "mary",
      last: "watson",
    });
  });
  it("returns nulls for empty input", () => {
    expect(splitName("")).toEqual({ first: null, last: null });
  });
});

// ─── isRolePrefix ─────────────────────────────────────────────────────────

describe("isRolePrefix", () => {
  it.each([
    ["it", true],
    ["info", true],
    ["support", true],
    ["it.dept", true],
    ["support_team", true],
    ["sales-eu", true],
    ["press+pitches", true],
    ["jane", false],
    ["jdoe", false],
    ["jane.doe", false],
    ["italian.person", false], // doesn't start with "it" + separator
    ["informal", false], // doesn't start with "info" + separator
  ])("isRolePrefix(%s) → %s", (local, expected) => {
    expect(isRolePrefix(local)).toBe(expected);
  });
});

// ─── emailMatchesName ─────────────────────────────────────────────────────

describe("emailMatchesName", () => {
  it("rejects role-style addresses for a real person", () => {
    expect(emailMatchesName("it@acme.com", "Jane", "Doe")).toBe(false);
    expect(emailMatchesName("support@acme.com", "Jane", "Doe")).toBe(false);
  });
  it.each([
    ["jane@acme.com", "Jane", "Doe"],
    ["doe@acme.com", "Jane", "Doe"],
    ["jane.doe@acme.com", "Jane", "Doe"],
    ["jdoe@acme.com", "Jane", "Doe"],
    ["janed@acme.com", "Jane", "Doe"],
    ["doe.jane@acme.com", "Jane", "Doe"],
    ["jane_doe@acme.com", "Jane", "Doe"],
    ["jay.sahnan@browserbase.com", "Jay", "Sahnan"],
  ])("accepts %s for %s %s", (email, first, last) => {
    expect(emailMatchesName(email, first, last)).toBe(true);
  });
  it("rejects unrelated names", () => {
    expect(emailMatchesName("bob@acme.com", "Jane", "Doe")).toBe(false);
  });
  it("handles missing last name gracefully", () => {
    expect(emailMatchesName("madonna@acme.com", "Madonna", null)).toBe(true);
    expect(emailMatchesName("admin@acme.com", "Madonna", null)).toBe(false);
  });
});

// ─── applyPattern ─────────────────────────────────────────────────────────

describe("applyPattern", () => {
  const cases: Array<[string, string, string, string, string]> = [
    ["{first}.{last}", "Jane", "Doe", "acme.com", "jane.doe@acme.com"],
    ["{first}{last}", "Jane", "Doe", "acme.com", "janedoe@acme.com"],
    ["{f}{last}", "Jane", "Doe", "acme.com", "jdoe@acme.com"],
    ["{first}_{last}", "Jane", "Doe", "acme.com", "jane_doe@acme.com"],
    ["{first}-{last}", "Jane", "Doe", "acme.com", "jane-doe@acme.com"],
    ["{f}.{last}", "Jane", "Doe", "acme.com", "j.doe@acme.com"],
    ["{first}.{l}", "Jane", "Doe", "acme.com", "jane.d@acme.com"],
    ["{first}", "Jane", "Doe", "acme.com", "jane@acme.com"],
    ["{last}", "Jane", "Doe", "acme.com", "doe@acme.com"],
  ];
  it.each(cases)(
    "applyPattern(%s, %s, %s, %s) → %s",
    (pattern, first, last, domain, expected) => {
      expect(applyPattern(pattern, first, last, domain)).toBe(expected);
    },
  );

  it("strips non-alphanumeric from name parts", () => {
    expect(
      applyPattern("{first}.{last}", "Marie-Claire", "O'Brien", "acme.com"),
    ).toBe("marieclaire.obrien@acme.com");
  });

  it("returns null when last name needed but missing", () => {
    expect(
      applyPattern("{first}.{last}", "Madonna", null, "acme.com"),
    ).toBeNull();
  });

  it("works with single-name + first-only pattern", () => {
    expect(applyPattern("{first}", "Madonna", null, "acme.com")).toBe(
      "madonna@acme.com",
    );
  });

  it("lowercases the domain", () => {
    expect(applyPattern("{first}", "Jane", null, "Acme.COM")).toBe(
      "jane@acme.com",
    );
  });
});

// ─── inferPattern ─────────────────────────────────────────────────────────

describe("inferPattern", () => {
  it("returns null pattern when no emails are provided", () => {
    expect(inferPattern([])).toEqual({
      pattern: null,
      confidence: 0,
      evidenceCount: 0,
    });
  });

  it("finds the right pattern from a single team-page email", () => {
    const emails = [
      {
        email: "jane.doe@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "team_page" as EmailSource,
      },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}.{last}");
    expect(result.confidence).toBeCloseTo(1.0);
    expect(result.evidenceCount).toBe(1);
  });

  it("aggregates multiple matching emails", () => {
    const emails = [
      { email: "jane.doe@acme.com", firstName: "Jane", lastName: "Doe", source: "team_page" as EmailSource },
      { email: "bob.smith@acme.com", firstName: "Bob", lastName: "Smith", source: "team_page" as EmailSource },
      { email: "lee.jones@acme.com", firstName: "Lee", lastName: "Jones", source: "send_confirmed" as EmailSource },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}.{last}");
    expect(result.evidenceCount).toBe(3);
    expect(result.confidence).toBeCloseTo(1.0);
  });

  it("ignores role-prefix addresses entirely", () => {
    const emails = [
      { email: "it@acme.com", firstName: "Jane", lastName: "Doe", source: "team_page" as EmailSource },
    ];
    expect(inferPattern(emails).pattern).toBeNull();
  });

  it("favors send_confirmed evidence over scraped emails when patterns conflict", () => {
    const emails = [
      { email: "jane.doe@acme.com", firstName: "Jane", lastName: "Doe", source: "team_page" as EmailSource },
      { email: "bob@acme.com", firstName: "Bob", lastName: "Smith", source: "send_confirmed" as EmailSource },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThan(1);
  });

  it("ignores pattern_derived sources (no feedback loop)", () => {
    const emails = [
      { email: "jane.doe@acme.com", firstName: "Jane", lastName: "Doe", source: "pattern_derived" as EmailSource },
    ];
    expect(inferPattern(emails).pattern).toBeNull();
  });

  it("includes every known pattern in scoring", () => {
    expect(KNOWN_PATTERNS).toContain("{first}.{last}");
    expect(KNOWN_PATTERNS).toContain("{first}");
  });
});

// ─── mxCheck ──────────────────────────────────────────────────────────────

describe("mxCheck", () => {
  it("returns true when DNS returns at least one MX record", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([{ exchange: "smtp.example.com", priority: 10 }]);
    expect(await mxCheck("acme.com", resolver)).toBe(true);
  });

  it("returns false when DNS lookup throws (NXDOMAIN, etc.)", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("NXDOMAIN"));
    expect(await mxCheck("nope.invalid", resolver)).toBe(false);
  });

  it("returns false when DNS returns zero MX records", async () => {
    const resolver = vi.fn().mockResolvedValue([]);
    expect(await mxCheck("noemail.example.com", resolver)).toBe(false);
  });
});

// ─── recordVerifiedEmail ──────────────────────────────────────────────────

describe("recordVerifiedEmail", () => {
  it("skips role-prefix addresses (does not write)", async () => {
    const { adapter, tables } = createFakeDb({
      people: [{ id: "p1", name: "Jane Doe", organization_id: "o1" }],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(adapter, {
      personId: "p1",
      email: "it@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBeNull();
    expect(tables.people[0].work_email_source).toBeNull();
  });

  it("writes a new email when person has none", async () => {
    const { adapter, tables } = createFakeDb({
      people: [{ id: "p1", name: "Jane Doe", organization_id: "o1" }],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(adapter, {
      personId: "p1",
      email: "Jane.Doe@Acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBe("jane.doe@acme.com");
    expect(tables.people[0].work_email_source).toBe("team_page");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.7);
    expect(tables.people[0].work_email_verified_at).not.toBeNull();
  });

  it("does NOT downgrade send_confirmed → team_page on a different email", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(adapter, {
      personId: "p1",
      email: "jane.doe@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBe("jane@acme.com");
    expect(tables.people[0].work_email_source).toBe("send_confirmed");
  });

  it("upgrades team_page → user_entered for the same email", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(adapter, {
      personId: "p1",
      email: "jane@acme.com",
      source: "user_entered",
    });
    expect(tables.people[0].work_email_source).toBe("user_entered");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(1.0);
  });

  it("keeps the stronger source on a same-email refresh with weaker source", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(adapter, {
      personId: "p1",
      email: "jane@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email_source).toBe("send_confirmed");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.95);
    expect(tables.people[0].work_email_verified_at).not.toBeNull();
  });
});

// ─── recordBounce ─────────────────────────────────────────────────────────

describe("recordBounce", () => {
  it("no-ops when person not found", async () => {
    const { adapter, tables } = createFakeDb({});
    await recordBounce(adapter, { personId: "missing", email: "x@y.com" });
    expect(tables.people).toHaveLength(0);
  });

  it("no-ops when bounced email differs from stored work_email", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
          work_email_verified_at: "2026-04-25T00:00:00Z",
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordBounce(adapter, {
      personId: "p1",
      email: "different@acme.com",
    });
    expect(tables.people[0].work_email_verified_at).toBe(
      "2026-04-25T00:00:00Z",
    );
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.95);
  });

  it("clears verified_at + confidence on the person", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
          work_email_verified_at: "2026-04-25T00:00:00Z",
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordBounce(adapter, { personId: "p1", email: "jane@acme.com" });
    expect(tables.people[0].work_email_verified_at).toBeNull();
    expect(tables.people[0].work_email_confidence).toBe(0);
  });

  it("does NOT touch the org pattern when source != pattern_derived", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
        },
      ],
      organizations: [
        {
          id: "o1",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.9,
          email_pattern_evidence_count: 3,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(adapter, { personId: "p1", email: "jane@acme.com" });
    expect(tables.organizations[0].email_pattern).toBe("{first}.{last}");
    expect(tables.organizations[0].email_pattern_confidence).toBeCloseTo(0.9);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(0);
  });

  it("halves the pattern confidence when bounce ratio crosses 0.3", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 3,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(adapter, { personId: "p1", email: "jane@acme.com" });
    expect(tables.organizations[0].email_pattern).toBe("{first}.{last}");
    expect(tables.organizations[0].email_pattern_confidence).toBeCloseTo(0.4);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });

  it("clears the pattern entirely when bounce ratio crosses 0.5", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 1,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(adapter, { personId: "p1", email: "jane@acme.com" });
    expect(tables.organizations[0].email_pattern).toBeNull();
    expect(tables.organizations[0].email_pattern_confidence).toBe(0);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });

  it("does NOT wipe a pattern when evidence_count is 0 even after recompute", async () => {
    const { adapter, tables } = createFakeDb({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 0,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(adapter, { personId: "p1", email: "jane@acme.com" });
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });
});
