import { describe, expect, it, vi } from "vitest";

// getContacts: db.select({...}).from(campaignPeople).innerJoin(people,...).leftJoin(organizations,...).where(...).orderBy(...)
// Returns flat rows without enrichment_data

const { mockSelect } = vi.hoisted(() => {
  const fakeRows = [
    {
      id: "cp1",
      personId: "p1",
      campaignId: "c1",
      outreachStatus: null,
      priorityScore: "8",
      scoreReason: "good fit",
      createdAt: new Date("2026-04-18T00:00:00Z"),
      updatedAt: new Date("2026-04-18T00:00:00Z"),
      name: "Alice",
      title: "CTO",
      workEmail: "alice@acme.com",
      personalEmail: null,
      linkedinUrl: "https://linkedin.com/in/alice",
      twitterUrl: null,
      enrichmentStatus: "enriched",
      source: "exa",
      organizationId: "o1",
      orgName: "Acme",
      orgDomain: "acme.com",
      orgIndustry: "SaaS",
    },
  ];

  const mockOrderBy = vi.fn().mockResolvedValue(fakeRows);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockInnerJoin = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });
  const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockSelect };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { getContacts } from "@/lib/tools/enrichment-tools";

describe("getContacts return shape", () => {
  it("omits enrichment_data from each row", async () => {
    const result = (await getContacts.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { contacts: Array<Record<string, unknown>> };

    expect(result.contacts).toHaveLength(1);
    const row = result.contacts[0];
    expect(row).not.toHaveProperty("enrichment_data");
    expect(JSON.stringify(row)).not.toContain("SHOULD_NOT_APPEAR_IN_LIST");
    // Still carries the fields the agent needs to pick someone to draft for:
    expect(row).toMatchObject({
      person_id: "p1",
      name: "Alice",
      title: "CTO",
      work_email: "alice@acme.com",
      priority_score: "8",
    });
  });
});
