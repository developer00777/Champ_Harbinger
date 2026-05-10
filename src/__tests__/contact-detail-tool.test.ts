import { beforeEach, describe, expect, it, vi } from "vitest";

// getContactDetail: db.select({...}).from(schema.people).leftJoin(organizations,...).where(...).limit(1)
// const [data] = await db.select(...).from(people).leftJoin(...).where(...).limit(1)

const { mockLimit, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockLimit, mockSelect };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { getContactDetail } from "@/lib/tools/enrichment-tools";

describe("getContactDetail", () => {
  beforeEach(() => {
    mockLimit.mockReset();
  });

  it("returns one contact with full enrichment_data and company enrichment", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: "p1",
        name: "Alice",
        title: "CTO",
        workEmail: "alice@acme.com",
        personalEmail: null,
        linkedinUrl: "https://linkedin.com/in/alice",
        twitterUrl: null,
        enrichmentStatus: "enriched",
        enrichmentData: { bio: "Long LinkedIn bio..." },
        orgId: "o1",
        orgName: "Acme",
        orgDomain: "acme.com",
        orgIndustry: "SaaS",
        orgLocation: null,
        orgDescription: null,
        orgEnrichmentData: { website_summary: "..." },
        orgEnrichmentStatus: "enriched",
      },
    ]);

    const result = await getContactDetail.execute!(
      { personId: "p1" },
      {} as never,
    );

    expect(result).toMatchObject({
      id: "p1",
      name: "Alice",
      enrichment_data: { bio: "Long LinkedIn bio..." },
      company: { name: "Acme", enrichment_data: { website_summary: "..." } },
    });
  });

  it("returns error when contact not found", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await getContactDetail.execute!(
      { personId: "missing" },
      {} as never,
    );

    expect(result).toEqual({ error: expect.stringContaining("not found") });
  });
});
