import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { getLakeB2BClient } from "@/lib/lakeb2b/client";
import {
  translateCompanyCriteria,
  translatePeopleCriteria,
} from "@/lib/lakeb2b/criteria";
import { verifyCompanies, verifyPeople } from "@/lib/lakeb2b/verifier";

export const discoverWithLakeB2B = tool({
  description:
    "Discover companies or people from the LakeB2B database (120M+ verified contacts and companies) using natural language criteria. " +
    "Translates your criteria to a structured query, searches the database, and AI-verifies each result against your original criteria. " +
    "Use this when the user wants high-quality, verified prospect data — especially for targeted ICP matching. " +
    "Returns a filtered, AI-verified list with reasons, ready for enrichment or outreach.",
  inputSchema: z.object({
    criteria: z
      .string()
      .describe(
        "Natural language description of what you're looking for. Be specific. " +
          "Examples: 'B2B SaaS companies in the US with 10-50 employees that raised seed funding', " +
          "'VP of Engineering at fintech startups in New York with 50-200 employees'",
      ),
    targetType: z
      .enum(["company", "person"])
      .describe("Whether to search for companies or individual people"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .optional()
      .describe(
        "Maximum number of results to fetch before verification (default 20)",
      ),
  }),
  execute: async ({ criteria, targetType, maxResults = 20 }) => {
    const client = await getLakeB2BClient();
    const isMock =
      process.env.LAKEB2B_MOCK === "true" || !process.env.LAKEB2B_API_URL;

    if (targetType === "company") {
      const params = await translateCompanyCriteria(criteria);
      params.per_page = Math.min(maxResults, 50);

      const result = await client.searchCompanies(params);
      const verified = await verifyCompanies(result.results, criteria);
      const passing = verified.filter((c) => c.passes);

      return {
        criteria,
        targetType: "company" as const,
        queryParams: params,
        totalFound: result.total,
        fetched: result.results.length,
        verified: passing.length,
        mode: isMock ? "mock" : "live",
        results: passing.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          industry: c.industry,
          employees:
            c.employee_range ??
            (c.employee_count ? String(c.employee_count) : undefined),
          location: [c.location?.city, c.location?.state, c.location?.country]
            .filter(Boolean)
            .join(", "),
          funding: c.funding_stage
            ? `${c.funding_stage}${c.funding_total_usd ? ` ($${(c.funding_total_usd / 1_000_000).toFixed(1)}M)` : ""}`
            : undefined,
          description: c.description,
          website: c.website,
          linkedin: c.linkedin_url,
          verification_reason: c.reason,
        })),
        skipped: verified
          .filter((c) => !c.passes)
          .map((c) => ({ name: c.name, reason: c.reason })),
      };
    } else {
      const params = await translatePeopleCriteria(criteria);
      params.per_page = Math.min(maxResults, 50);

      const result = await client.searchPeople(params);
      const verified = await verifyPeople(result.results, criteria);
      const passing = verified.filter((p) => p.passes);

      return {
        criteria,
        targetType: "person" as const,
        queryParams: params,
        totalFound: result.total,
        fetched: result.results.length,
        verified: passing.length,
        mode: isMock ? "mock" : "live",
        results: passing.map((p) => ({
          id: p.id,
          name: p.full_name,
          title: p.title,
          company: p.company_name,
          email: p.email,
          location: [p.location?.city, p.location?.state, p.location?.country]
            .filter(Boolean)
            .join(", "),
          linkedin: p.linkedin_url,
          verification_reason: p.reason,
        })),
        skipped: verified
          .filter((p) => !p.passes)
          .map((p) => ({ name: p.full_name, reason: p.reason })),
      };
    }
  },
});
