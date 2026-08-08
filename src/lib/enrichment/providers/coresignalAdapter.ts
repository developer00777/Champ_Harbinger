import "server-only";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { buildFieldValue } from "../confidence";
import type { EnrichmentSettings } from "../config";
import {
  emptyResult,
  minimalIdentifiers,
  Tier,
  type Contact,
  type FieldValue,
  type ProviderResult,
} from "../types";
import type { ProviderAdapter } from "./base";
import { resolveProviderKey } from "./keys";
import { normalizeLinkedInUrl } from "./linkedinResolver";

/**
 * Coresignal person-enrichment adapter (paid data API, waterfall tier T2),
 * mirroring peopleDataLabsAdapter.ts. Registered just ahead of PDL in the
 * default provider priority (see ../config.ts DEFAULT_PROVIDER_PRIORITY) so
 * that, once a Coresignal key is configured, it takes the paid-tier gap-fill
 * slot PDL would otherwise occupy — the same plug-and-play relationship
 * Coresignal has with LakeB2B on the discovery side
 * (src/lib/discovery/coresignal-provider.ts).
 *
 * Runs only for fields still missing after the owned tiers + LakeB2B, and
 * only when a key is configured (env CORESIGNAL_API_KEY or per-user BYOK
 * coresignal_api_key).
 *
 * By LinkedIn URL: GET Multi-source Employee API collect-by-profile-url
 *   https://api.coresignal.com/cdapi/v2/employee_multi_source/collect/{profile_url}
 *   (header `apikey`). 404 = no match.
 * Without a LinkedIn URL (name + company only): falls back to one Agentic
 *   Search "fast" call (entity=employee, limit=1) — best-effort, since
 *   Coresignal has no direct name+company collect endpoint.
 */

const SUPPLIABLE = new Set([
  "email",
  "title",
  "seniority",
  "linkedin",
  "company",
]);
const BASE_URL = "https://api.coresignal.com/cdapi";
const COLLECT_ENDPOINT = `${BASE_URL}/v2/employee_multi_source/collect`;
const SEARCH_ENDPOINT = `${BASE_URL}/v2/agentic_search/fast`;

export interface CoresignalPerson {
  full_name?: string;
  headline?: string;
  active_experience_title?: string;
  active_experience_management_level?: string;
  primary_professional_email?: string;
  professional_emails_collection?: Array<{ email?: string }>;
  professional_network_url?: string;
  company_name?: string;
  active_experience_company_shorthand_name?: string;
  active_experience_company_website?: string;
  company_industry?: string;
  location_full?: string;
}

export type CoresignalLookupFn = (
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    email: string | null;
  },
  clerkUserId?: string,
) => Promise<CoresignalPerson | null>;

export interface CoresignalAdapterDeps {
  lookup?: CoresignalLookupFn;
  isConfigured?: (clerkUserId?: string) => Promise<boolean>;
}

async function resolveKey(clerkUserId?: string): Promise<string | null> {
  return resolveProviderKey(
    "coresignal_api_key",
    process.env.CORESIGNAL_API_KEY,
    clerkUserId,
  );
}

async function collectByLinkedIn(
  key: string,
  linkedinUrl: string,
): Promise<CoresignalPerson | null> {
  const res = await fetchWithTimeout(
    `${COLLECT_ENDPOINT}/${encodeURIComponent(linkedinUrl)}`,
    { method: "GET", headers: { accept: "application/json", apikey: key } },
    30_000,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Coresignal collect ${res.status}`);
  return (await res.json()) as CoresignalPerson;
}

async function searchByNameCompany(
  key: string,
  fullName: string,
  company: string | null,
): Promise<CoresignalPerson | null> {
  const prompt = company
    ? `Find the person named ${fullName} who works at ${company}.`
    : `Find the person named ${fullName}.`;
  const res = await fetchWithTimeout(
    SEARCH_ENDPOINT,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        return_data: true,
        limit: 1,
        entity: "employee",
      }),
    },
    30_000,
  );
  if (!res.ok) throw new Error(`Coresignal agentic_search/fast ${res.status}`);
  const body = (await res.json()) as
    CoresignalPerson[] | { results?: CoresignalPerson[] };
  const rows = Array.isArray(body) ? body : (body.results ?? []);
  return rows[0] ?? null;
}

async function defaultLookup(
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    email: string | null;
  },
  clerkUserId?: string,
): Promise<CoresignalPerson | null> {
  const key = await resolveKey(clerkUserId);
  if (!key) return null;

  if (ident.linkedinUrl) {
    return collectByLinkedIn(key, ident.linkedinUrl);
  }
  if (ident.fullName) {
    return searchByNameCompany(key, ident.fullName, ident.company);
  }
  return null;
}

async function defaultIsConfigured(clerkUserId?: string): Promise<boolean> {
  return (await resolveKey(clerkUserId)) !== null;
}

export class CoresignalAdapter implements ProviderAdapter {
  readonly tier = Tier.T2Person;
  readonly name = "coresignal";
  readonly costPerCall: number;
  private readonly deps: CoresignalAdapterDeps;

  constructor(deps: CoresignalAdapterDeps = {}) {
    this.deps = deps;
    this.costPerCall = Number(process.env.COST_CORESIGNAL) || 0.02;
  }

  canSupply(requiredFields: string[]): boolean {
    return requiredFields.some((f) => SUPPLIABLE.has(f));
  }

  isEnabled(
    _settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<boolean> {
    return (this.deps.isConfigured ?? defaultIsConfigured)(clerkUserId);
  }

  async fetch(
    contact: Contact,
    settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<ProviderResult> {
    const started = Date.now();
    const ident = minimalIdentifiers(contact);
    const lookup = this.deps.lookup ?? defaultLookup;

    let person: CoresignalPerson | null = null;
    try {
      person = await lookup(ident, clerkUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...emptyResult(this.name, this.tier, `coresignal_lookup: ${msg}`),
        latencyMs: Date.now() - started,
        requestIdentifiers: { fullName: ident.fullName, domain: ident.domain },
      };
    }

    if (!person) {
      return {
        ...emptyResult(this.name, this.tier, "coresignal_no_match"),
        latencyMs: Date.now() - started,
        requestIdentifiers: { fullName: ident.fullName, domain: ident.domain },
      };
    }

    const fields: Record<string, FieldValue> = {};
    const mk = (value: unknown): FieldValue =>
      buildFieldValue({
        value,
        provider: this.name,
        settings,
        verified: false,
      });

    const email =
      person.primary_professional_email ??
      person.professional_emails_collection?.[0]?.email ??
      null;
    if (email) fields.email = mk(email); // gate verifies downstream
    const title = person.active_experience_title ?? person.headline;
    if (title) fields.title = mk(title);
    if (person.active_experience_management_level) {
      fields.seniority = mk(person.active_experience_management_level);
    }
    const company =
      person.company_name ?? person.active_experience_company_shorthand_name;
    if (company) fields.company = mk(company);
    if (person.professional_network_url) {
      const norm = person.professional_network_url.startsWith("http")
        ? person.professional_network_url
        : `https://${person.professional_network_url}`;
      fields.linkedin = mk(normalizeLinkedInUrl(norm) ?? norm);
    }

    const firmographics: Record<string, unknown> = {};
    const setFirmo = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && v !== "") firmographics[k] = v;
    };
    setFirmo("industry", person.company_industry);
    setFirmo("company_domain", person.active_experience_company_website);
    setFirmo("contact_location", person.location_full);

    const success =
      Object.keys(fields).length > 0 || Object.keys(firmographics).length > 0;

    return {
      provider: this.name,
      tier: this.tier,
      success,
      fields,
      firmographics,
      emailVerification: null,
      // A returned record consumes a Coresignal credit regardless of yield.
      costUsd: this.costPerCall,
      latencyMs: Date.now() - started,
      httpStatus: null,
      error: success ? null : "coresignal_empty",
      requestIdentifiers: {
        fullName: ident.fullName,
        company: ident.company,
        domain: ident.domain,
        linkedinUrl: ident.linkedinUrl,
      },
    };
  }
}
