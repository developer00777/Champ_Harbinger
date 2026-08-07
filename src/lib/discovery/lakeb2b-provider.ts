import { getLakeB2BClient, hasLakeB2BKey } from "@/lib/lakeb2b/client";
import {
  translateCompanyCriteria,
  translatePeopleCriteria,
} from "@/lib/lakeb2b/criteria";
import { verifyCompanies, verifyPeople } from "@/lib/lakeb2b/verifier";
import type { DiscoveryProvider } from "./types";

/** Page size to request per upstream call while paginating. */
const PAGE_SIZE = 50;
/** Safety valve so a bad `max` can't spin forever against a paging API. */
const MAX_PAGES = 20;

/**
 * Pull pages until we have `max` records, the API says there are no more, or
 * we hit MAX_PAGES.
 *
 * Previously every call requested `page: 1` only and discarded `has_more`,
 * which capped discovery at a single page no matter what `max` was — the
 * single biggest limiter on how many companies a run could return.
 */
async function paginate<T>(
  max: number,
  fetchPage: (
    page: number,
    perPage: number,
  ) => Promise<{
    results: T[];
    has_more?: boolean;
  }>,
): Promise<T[]> {
  const collected: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const remaining = max - collected.length;
    if (remaining <= 0) break;

    const result = await fetchPage(page, Math.min(remaining, PAGE_SIZE));
    const batch = result?.results ?? [];
    collected.push(...batch);

    // Stop on an explicit "no more", or on a short/empty page — a provider
    // that omits has_more still signals exhaustion by returning fewer rows.
    if (result?.has_more === false) break;
    if (batch.length === 0) break;
    if (result?.has_more === undefined && batch.length < PAGE_SIZE) break;
  }

  return collected.slice(0, max);
}

/**
 * LakeB2B-backed discovery: NL criteria → structured query → search → verify.
 *
 * Falls back to the built-in mock client when no real API key is configured.
 * That fallback is reported through `usesMockData` so callers can warn rather
 * than silently presenting 20 fixture companies as real leads.
 */
export function makeLakeB2BProvider(clerkUserId?: string): DiscoveryProvider {
  return {
    name: "lakeb2b",
    async usesMockData() {
      return !(await hasLakeB2BKey(clerkUserId));
    },
    async discoverCompanies(criteria, max) {
      const client = await getLakeB2BClient(clerkUserId);
      const params = await translateCompanyCriteria(criteria, clerkUserId);
      const rows = await paginate(max, async (page, perPage) => {
        const result = await client.searchCompanies({
          ...params,
          page,
          per_page: perPage,
        });
        return { results: result.results, has_more: result.has_more };
      });
      return verifyCompanies(rows, criteria, clerkUserId);
    },
    async discoverPeople(criteria, max) {
      const client = await getLakeB2BClient(clerkUserId);
      const params = await translatePeopleCriteria(criteria, clerkUserId);
      const rows = await paginate(max, async (page, perPage) => {
        const result = await client.searchPeople({
          ...params,
          page,
          per_page: perPage,
        });
        return { results: result.results, has_more: result.has_more };
      });
      return verifyPeople(rows, criteria, clerkUserId);
    },
  };
}
