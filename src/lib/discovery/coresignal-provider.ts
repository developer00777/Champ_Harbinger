import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { resolveProviderKey } from "@/lib/enrichment/providers/keys";
import { verifyCompanies, verifyPeople } from "@/lib/lakeb2b/verifier";
import type { Company, Person } from "@/lib/lakeb2b/schemas";
import type { DiscoveryProvider } from "./types";

/**
 * Coresignal-backed discovery, filling the same seam as LakeB2B
 * (src/lib/discovery/lakeb2b-provider.ts) so it can be swapped in for testing
 * without LakeB2B and swapped back out once LakeB2B is ready — see
 * src/lib/discovery/index.ts for the selection order.
 *
 * Uses the Agentic Search API's "fast" mode: a plain-English prompt goes in,
 * matching records come back directly (data mode, `return_data: true`) — no
 * query-building step needed on our side. The "reasoning" mode exists too but
 * is rate-limited to 10 requests/hour, unusable for interactive discovery.
 *
 * Docs: https://docs.coresignal.com/agentic-search-api/agentic-search-api
 */

const BASE_URL = "https://api.coresignal.com/cdapi";
const FAST_ENDPOINT = `${BASE_URL}/v2/agentic_search/fast`;
// Fast mode returns "up to 100 matching records directly" per call.
const MAX_PER_CALL = 100;

interface CoresignalEmployeeRecord {
  id: number | string;
  full_name?: string;
  professional_network_url?: string;
  headline?: string;
  location_full?: string;
  location_country?: string;
  company_name?: string;
  company_website?: string;
  company_industry?: string;
  active_experience_title?: string;
}

interface CoresignalCompanyRecord {
  id: number | string;
  company_name?: string;
  professional_network_url?: string;
  website?: string;
  size_range?: string;
  employees_count?: number;
  industry?: string;
  hq_country?: string;
}

async function resolveKey(clerkUserId?: string): Promise<string | null> {
  return resolveProviderKey(
    "coresignal_api_key",
    process.env.CORESIGNAL_API_KEY,
    clerkUserId,
  );
}

/** True when a real Coresignal key is configured (env or per-user BYOK). */
export async function hasCoresignalKey(clerkUserId?: string): Promise<boolean> {
  return (await resolveKey(clerkUserId)) !== null;
}

async function agenticSearch<T>(
  apiKey: string,
  entity: "employee" | "company",
  prompt: string,
  limit: number,
): Promise<T[]> {
  const res = await fetchWithTimeout(
    FAST_ENDPOINT,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        return_data: true,
        limit: Math.min(Math.max(1, limit), MAX_PER_CALL),
        entity,
      }),
    },
    30_000,
  );
  if (!res.ok) {
    throw new Error(`Coresignal agentic_search/fast ${res.status}`);
  }
  const body = (await res.json()) as T[] | { results?: T[] };
  return Array.isArray(body) ? body : (body.results ?? []);
}

function mapCompany(r: CoresignalCompanyRecord): Company {
  return {
    id: `coresignal:${r.id}`,
    name: r.company_name ?? "Unknown company",
    domain: r.website?.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    industry: r.industry,
    employee_count: r.employees_count,
    employee_range: r.size_range,
    location: r.hq_country ? { country: r.hq_country } : undefined,
    website: r.website,
    linkedin_url: r.professional_network_url,
  };
}

function mapPerson(r: CoresignalEmployeeRecord): Person {
  const [city, state, country] = (r.location_full ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: `coresignal:${r.id}`,
    full_name: r.full_name ?? "Unknown",
    title: r.active_experience_title ?? r.headline,
    company_name: r.company_name,
    linkedin_url: r.professional_network_url,
    location:
      r.location_country || country
        ? { country: r.location_country ?? country, state, city }
        : undefined,
  };
}

export function makeCoresignalProvider(
  clerkUserId?: string,
): DiscoveryProvider {
  return {
    name: "coresignal",
    async usesMockData() {
      return false; // no mock mode — dormant (empty results) without a key
    },
    async discoverCompanies(criteria, max) {
      const key = await resolveKey(clerkUserId);
      if (!key) return [];
      const records = await agenticSearch<CoresignalCompanyRecord>(
        key,
        "company",
        criteria,
        max,
      );
      return verifyCompanies(records.map(mapCompany), criteria, clerkUserId);
    },
    async discoverPeople(criteria, max) {
      const key = await resolveKey(clerkUserId);
      if (!key) return [];
      const records = await agenticSearch<CoresignalEmployeeRecord>(
        key,
        "employee",
        criteria,
        max,
      );
      return verifyPeople(records.map(mapPerson), criteria, clerkUserId);
    },
  };
}
