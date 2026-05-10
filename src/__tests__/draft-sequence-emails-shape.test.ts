import { describe, expect, it, vi } from "vitest";

// draftSequenceEmails uses:
//   - `db` from "@/db" for queries
//   - `schema` from "@/lib/db/scoped" for table/column references
//   - `getScopedDb` from "@/lib/db/scoped" (only used by createSequence, not draftSequenceEmails)

// Mock email composition utilities (only draftEmailsForSequence uses them)
vi.mock("@/lib/email-composition/compose", () => ({
  composeEmail: vi.fn(),
  mapConcurrent: vi.fn(),
}));
vi.mock("@/lib/email-composition/load-skills", () => ({
  loadActiveEmailSkills: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/email-composition/save", () => ({
  saveDraft: vi.fn(),
}));

// Build a mock db.select() that cycles through expected query results in order.
const { mockSelect } = vi.hoisted(() => {
  let callCount = 0;

  const sequenceRow = { id: "seq1", name: "RE Outreach", campaignId: "c1" };
  const stepsRows = [
    { id: "st1", stepNumber: 1, delayDays: null, condition: null },
    { id: "st2", stepNumber: 2, delayDays: 3, condition: null },
  ];
  const enrollmentsRows = [
    { id: "en1", personId: "p1", campaignPeopleId: "cp1" },
  ];
  const peopleRows = [
    {
      id: "p1",
      name: "Alice",
      title: "CTO",
      workEmail: "alice@acme.com",
      personalEmail: null,
      organizationId: "o1",
    },
  ];
  const orgsRows = [{ id: "o1", name: "Acme", domain: "acme.com" }];

  function makeChain(data: unknown[]) {
    const limit = vi.fn().mockResolvedValue(data);
    const orderBy = vi.fn().mockResolvedValue(data);
    // .where() resolves to data directly (for inArray queries), and also supports chaining
    const whereResolvable = Object.assign(Promise.resolve(data), {
      limit,
      orderBy,
    });
    const where = vi.fn().mockReturnValue(whereResolvable);
    return { from: vi.fn().mockReturnValue({ where, orderBy, limit }) };
  }

  const mockSelect = vi.fn().mockImplementation(() => {
    callCount++;
    const n = callCount;
    if (n === 1) return makeChain([sequenceRow]);
    if (n === 2) return makeChain(stepsRows);
    if (n === 3) return makeChain(enrollmentsRows);
    if (n === 4) return makeChain(peopleRows);
    return makeChain(orgsRows);
  });

  return { mockSelect };
});

// Mock @/lib/db/scoped with the real schema so column references work.
vi.mock("@/lib/db/scoped", async () => {
  const realSchema = await import("@/lib/db/scoped")
    .then(() => import("../../db/schema"))
    .catch(async () => {
      // Fallback: import schema directly
      return import("../../db/schema");
    });
  return {
    getScopedDb: vi.fn().mockResolvedValue({
      raw: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      userId: "user1",
      orgId: null,
    }),
    schema: realSchema,
  };
});

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { draftSequenceEmails } from "@/lib/tools/sequence-tools";

describe("draftSequenceEmails return shape", () => {
  it("returns thin contact rows without enrichment_data", async () => {
    const result = (await draftSequenceEmails.execute!(
      { sequenceId: "seq1" },
      {} as never,
    )) as {
      contacts: Array<Record<string, unknown>>;
      instructions: string;
    };

    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0];
    expect(c).not.toHaveProperty("enrichmentData");
    expect(c).not.toHaveProperty("companyEnrichmentData");
    expect(JSON.stringify(c)).not.toContain("BIG_BIO_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(c)).not.toContain("BIG_SUMMARY_SHOULD_NOT_APPEAR");
    expect(c).toMatchObject({
      enrollmentId: "en1",
      personId: "p1",
      campaignPeopleId: "cp1",
      name: "Alice",
      title: "CTO",
      email: "alice@acme.com",
      company: "Acme",
      domain: "acme.com",
      organizationId: "o1",
    });
    expect(result.instructions).toMatch(/getContactDetail/);
  });
});
