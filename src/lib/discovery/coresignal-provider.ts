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
 * Preferred path is the Agentic Search API's "fast" mode: a plain-English
 * prompt goes in, matching records come back directly (data mode,
 * `return_data: true`) — no query-building step needed on our side. The
 * "reasoning" mode exists too but is rate-limited to 10 requests/hour,
 * unusable for interactive discovery.
 *
 * Agentic Search is a separately-billed add-on. On plans without it the
 * endpoint answers 402 "Billing: Insufficient credits", so we fall back to the
 * ES DSL search endpoints (company_base / employee_multi_source), which are
 * included in the base plan. Those return only record IDs — turning an ID into
 * a record needs the `collect` endpoints, which are themselves credit-gated —
 * so on a search-only plan discovery degrades to [] rather than inventing data.
 * See DISCOVERY_ENTITLEMENTS below for how each outcome is reported.
 *
 * Docs: https://docs.coresignal.com/agentic-search-api/agentic-search-api
 */

const BASE_URL = "https://api.coresignal.com/cdapi";
const FAST_ENDPOINT = `${BASE_URL}/v2/agentic_search/fast`;
const COMPANY_SEARCH_ENDPOINT = `${BASE_URL}/v2/company_base/search/es_dsl`;
const EMPLOYEE_SEARCH_ENDPOINT = `${BASE_URL}/v2/employee_multi_source/search/es_dsl`;
const COMPANY_COLLECT_ENDPOINT = `${BASE_URL}/v2/company_base/collect`;
const EMPLOYEE_COLLECT_ENDPOINT = `${BASE_URL}/v2/employee_multi_source/collect`;
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

/**
 * Thrown when Coresignal answers 402 on every data path available to us —
 * i.e. the key is valid but the plan carries no credits for returning records.
 * Distinct from a generic failure so callers can report "not entitled" rather
 * than "broken", and so a search-only plan degrades to [] instead of throwing.
 */
export class CoresignalNoCreditsError extends Error {
  constructor(message = "Coresignal: plan has no data credits") {
    super(message);
    this.name = "CoresignalNoCreditsError";
  }
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
  // 402 = Agentic Search not included in this plan. Signal it so the caller
  // can fall back to the ES DSL endpoints instead of failing the discovery.
  if (res.status === 402) {
    throw new CoresignalNoCreditsError("Coresignal agentic_search/fast 402");
  }
  if (!res.ok) {
    throw new Error(`Coresignal agentic_search/fast ${res.status}`);
  }
  const body = (await res.json()) as T[] | { results?: T[] };
  return Array.isArray(body) ? body : (body.results ?? []);
}

/**
 * ES DSL search. Included in the base plan, but returns bare record IDs only —
 * `_source`/`size`/`from` are rejected (422), so the record itself must be
 * fetched separately via `collect`.
 */
async function esDslSearch(
  apiKey: string,
  endpoint: string,
  query: unknown,
): Promise<Array<number | string>> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
    30_000,
  );
  if (res.status === 402) {
    throw new CoresignalNoCreditsError(`Coresignal es_dsl 402`);
  }
  if (!res.ok) throw new Error(`Coresignal es_dsl ${res.status}`);
  const body = (await res.json()) as Array<number | string>;
  return Array.isArray(body) ? body : [];
}

/**
 * Turn ES DSL ids into full records via `collect`. Each collect call spends a
 * credit, so this is where a search-only plan hits 402. Ids are fetched with
 * bounded concurrency; a 402 on the first record aborts the whole batch rather
 * than burning the remaining ids on calls that will fail identically.
 */
async function collectRecords<T>(
  apiKey: string,
  endpoint: string,
  ids: Array<number | string>,
  limit: number,
): Promise<T[]> {
  const wanted = ids.slice(0, Math.min(Math.max(1, limit), MAX_PER_CALL));
  const out: T[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (id) => {
        const res = await fetchWithTimeout(
          `${endpoint}/${encodeURIComponent(String(id))}`,
          {
            method: "GET",
            headers: { accept: "application/json", apikey: apiKey },
          },
          30_000,
        );
        if (res.status === 402) return "no-credits" as const;
        if (res.status === 404) return null;
        if (!res.ok) return null; // skip individual failures, keep the rest
        return (await res.json()) as T;
      }),
    );
    if (settled.includes("no-credits")) {
      throw new CoresignalNoCreditsError("Coresignal collect 402");
    }
    for (const r of settled) if (r && r !== "no-credits") out.push(r as T);
  }
  return out;
}

/**
 * Best-effort translation of free-text criteria into an ES DSL query. The
 * agentic endpoint does this properly server-side; without it we can only do
 * a broad multi-field match, which is why ES DSL is a fallback and not the
 * primary path.
 */
function criteriaToQuery(
  criteria: string,
  fields: string[],
): Record<string, unknown> {
  return {
    bool: {
      should: fields.map((field) => ({
        match: { [field]: { query: criteria, operator: "or" } },
      })),
      minimum_should_match: 1,
    },
  };
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

/** Fields the ES DSL fallback matches free-text criteria against. */
const COMPANY_QUERY_FIELDS = [
  "company_name",
  "industry",
  "hq_country",
  "size_range",
];
const EMPLOYEE_QUERY_FIELDS = [
  "active_experience_title",
  "headline",
  "location_country",
  "company_name",
];

/**
 * Run the agentic path; on a 402 (add-on not on this plan) retry via ES DSL.
 * If ES DSL also 402s — the base plan has no collect credits either — the key
 * is valid but the account cannot return records, so discovery degrades to []
 * and lets the other providers in the composite carry the result, rather than
 * failing the whole run.
 */
async function withEsDslFallback<T>(
  agentic: () => Promise<T[]>,
  esDsl: () => Promise<T[]>,
  label: string,
): Promise<T[]> {
  try {
    return await agentic();
  } catch (err) {
    if (!(err instanceof CoresignalNoCreditsError)) throw err;
    console.warn(
      `[discovery/coresignal] Agentic Search unavailable on this plan (402) — ` +
        `falling back to ES DSL search for ${label}.`,
    );
    try {
      return await esDsl();
    } catch (fallbackErr) {
      if (!(fallbackErr instanceof CoresignalNoCreditsError)) throw fallbackErr;
      console.warn(
        `[discovery/coresignal] Coresignal plan has no data credits — ES DSL ` +
          `search returns ids but 'collect' is credit-gated (402), so no ${label} ` +
          `records can be returned. Skipping Coresignal for this query.`,
      );
      return [];
    }
  }
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
      const records = await withEsDslFallback(
        () =>
          agenticSearch<CoresignalCompanyRecord>(key, "company", criteria, max),
        async () => {
          const ids = await esDslSearch(
            key,
            COMPANY_SEARCH_ENDPOINT,
            criteriaToQuery(criteria, COMPANY_QUERY_FIELDS),
          );
          return collectRecords<CoresignalCompanyRecord>(
            key,
            COMPANY_COLLECT_ENDPOINT,
            ids,
            max,
          );
        },
        "companies",
      );
      if (records.length === 0) return [];
      return verifyCompanies(records.map(mapCompany), criteria, clerkUserId);
    },
    async discoverPeople(criteria, max) {
      const key = await resolveKey(clerkUserId);
      if (!key) return [];
      const records = await withEsDslFallback(
        () =>
          agenticSearch<CoresignalEmployeeRecord>(
            key,
            "employee",
            criteria,
            max,
          ),
        async () => {
          const ids = await esDslSearch(
            key,
            EMPLOYEE_SEARCH_ENDPOINT,
            criteriaToQuery(criteria, EMPLOYEE_QUERY_FIELDS),
          );
          return collectRecords<CoresignalEmployeeRecord>(
            key,
            EMPLOYEE_COLLECT_ENDPOINT,
            ids,
            max,
          );
        },
        "people",
      );
      if (records.length === 0) return [];
      return verifyPeople(records.map(mapPerson), criteria, clerkUserId);
    },
  };
}
