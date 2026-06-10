import { getLakeB2BClient } from "@/lib/lakeb2b/client";
import {
  translateCompanyCriteria,
  translatePeopleCriteria,
} from "@/lib/lakeb2b/criteria";
import { verifyCompanies, verifyPeople } from "@/lib/lakeb2b/verifier";
import type { DiscoveryProvider } from "./types";

/**
 * LakeB2B-backed discovery: NL criteria → structured query → search → verify.
 * Uses the mock client automatically when no real API URL/key is configured.
 */
export function makeLakeB2BProvider(clerkUserId?: string): DiscoveryProvider {
  return {
    name: "lakeb2b",
    async discoverCompanies(criteria, max) {
      const client = await getLakeB2BClient(clerkUserId);
      const params = await translateCompanyCriteria(criteria);
      params.per_page = Math.min(max, 50);
      const result = await client.searchCompanies(params);
      return verifyCompanies(result.results, criteria);
    },
    async discoverPeople(criteria, max) {
      const client = await getLakeB2BClient(clerkUserId);
      const params = await translatePeopleCriteria(criteria);
      params.per_page = Math.min(max, 50);
      const result = await client.searchPeople(params);
      return verifyPeople(result.results, criteria);
    },
  };
}
