import { describe, expect, it, vi } from "vitest";

// getCompanies: db.select({...}).from(campaignOrganizations).innerJoin(...).where(...).orderBy(...)

const { mockSelect } = vi.hoisted(() => {
  const fakeRows = [
    {
      id: "co1",
      organizationId: "o1",
      campaignId: "c1",
      relevanceScore: "9",
      scoreReason: "perfect ICP",
      status: "qualified",
      createdAt: new Date("2026-04-18T00:00:00Z"),
      updatedAt: new Date("2026-04-18T00:00:00Z"),
      org: {
        id: "o1",
        name: "Acme",
        domain: "acme.com",
        url: "https://acme.com",
        industry: "SaaS",
        location: "SF",
        description: "short desc",
        enrichmentData: { website_summary: "SHOULD_NOT_APPEAR_IN_LIST" },
        enrichmentStatus: "enriched",
        source: "exa",
      },
    },
  ];

  const mockOrderBy = vi.fn().mockResolvedValue(fakeRows);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
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

import { getCompanies } from "@/lib/tools/search-tools";

describe("getCompanies return shape", () => {
  it("omits enrichment_data from each row", async () => {
    const result = (await getCompanies.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { companies: Array<Record<string, unknown>> };

    expect(result.companies).toHaveLength(1);
    const row = result.companies[0];
    expect(row).not.toHaveProperty("enrichment_data");
    expect(JSON.stringify(row)).not.toContain("SHOULD_NOT_APPEAR_IN_LIST");
    expect(row).toMatchObject({
      organization_id: "o1",
      name: "Acme",
      domain: "acme.com",
      relevance_score: "9",
    });
  });
});
