import { beforeEach, describe, expect, it, vi } from "vitest";

// getCompanyDetail: db.select({...}).from(schema.organizations).where(...).limit(1)
// const [data] = await db.select(...).from(...).where(...).limit(1)

const { mockLimit, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
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

import { getCompanyDetail } from "@/lib/tools/search-tools";

describe("getCompanyDetail", () => {
  beforeEach(() => {
    mockLimit.mockReset();
  });

  it("returns one company with full enrichment_data", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: "o1",
        name: "Acme",
        domain: "acme.com",
        url: null,
        industry: "SaaS",
        location: null,
        description: null,
        enrichmentData: { website_summary: "long...", exa_results: [1, 2, 3] },
        enrichmentStatus: "enriched",
      },
    ]);

    const result = await getCompanyDetail.execute!(
      { organizationId: "o1" },
      {} as never,
    );

    expect(result).toMatchObject({
      id: "o1",
      name: "Acme",
      enrichmentData: { website_summary: "long...", exa_results: [1, 2, 3] },
    });
  });

  it("returns error when company not found", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getCompanyDetail.execute!(
      { organizationId: "x" },
      {} as never,
    );
    expect(result).toEqual({ error: expect.stringContaining("not found") });
  });
});
