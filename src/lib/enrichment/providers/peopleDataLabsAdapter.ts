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
 * People Data Labs person-enrichment adapter (paid data API, waterfall tier T2).
 *
 * Runs only for fields still missing after the owned tiers + LakeB2B, and only
 * when a PDL key is configured (env PDL_API_KEY or per-user BYOK pdl_api_key).
 * PDL bills only on a match above min_likelihood, so a no-match/error costs
 * nothing. Only minimalIdentifiers leave; the lookup is INJECTED for testing.
 *
 * API: GET https://api.peopledatalabs.com/v5/person/enrich (header `X-Api-Key`).
 * Returns `{ status, likelihood, data: {...} }`; 404 on no match.
 */

const SUPPLIABLE = new Set([
  "email",
  "title",
  "seniority",
  "linkedin",
  "company",
]);
const ENRICH_ENDPOINT = "https://api.peopledatalabs.com/v5/person/enrich";

export interface PdlPerson {
  full_name?: string;
  job_title?: string;
  job_title_levels?: string[];
  work_email?: string;
  emails?: Array<{ address?: string; type?: string }>;
  linkedin_url?: string;
  job_company_name?: string;
  job_company_website?: string;
  job_company_industry?: string;
  location_name?: string;
}

export type PdlLookupFn = (
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    email: string | null;
  },
  clerkUserId?: string,
) => Promise<PdlPerson | null>;

export interface PeopleDataLabsAdapterDeps {
  lookup?: PdlLookupFn;
  isConfigured?: (clerkUserId?: string) => Promise<boolean>;
}

/** Minimum PDL match confidence (1-10) to accept a record. */
function minLikelihood(): number {
  const v = Number(process.env.PDL_MIN_LIKELIHOOD);
  return Number.isFinite(v) && v >= 1 && v <= 10 ? v : 6;
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
): Promise<PdlPerson | null> {
  const key = await resolveProviderKey(
    "pdl_api_key",
    process.env.PDL_API_KEY,
    clerkUserId,
  );
  if (!key) return null;

  const params = new URLSearchParams();
  if (ident.linkedinUrl) params.set("profile", ident.linkedinUrl);
  if (ident.email) params.set("email", ident.email);
  if (ident.fullName) params.set("name", ident.fullName);
  if (ident.company) params.set("company", ident.company);
  if (ident.domain && !ident.company) params.set("company", ident.domain);
  if ([...params.keys()].length === 0) return null;
  params.set("min_likelihood", String(minLikelihood()));

  const res = await fetchWithTimeout(
    `${ENRICH_ENDPOINT}?${params.toString()}`,
    { method: "GET", headers: { "X-Api-Key": key } },
    30_000,
  );
  // 404 = no match above likelihood; not an error, just empty.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`PDL ${res.status}`);
  }
  const body = (await res.json()) as { status?: number; data?: PdlPerson };
  return body.data ?? null;
}

async function defaultIsConfigured(clerkUserId?: string): Promise<boolean> {
  const key = await resolveProviderKey(
    "pdl_api_key",
    process.env.PDL_API_KEY,
    clerkUserId,
  );
  return key !== null;
}

export class PeopleDataLabsAdapter implements ProviderAdapter {
  readonly tier = Tier.T2Person;
  readonly name = "pdl";
  readonly costPerCall: number;
  private readonly deps: PeopleDataLabsAdapterDeps;

  constructor(deps: PeopleDataLabsAdapterDeps = {}) {
    this.deps = deps;
    this.costPerCall = Number(process.env.COST_PDL) || 0.1;
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

    // PDL bills only on a returned match, so failure/no-match costs nothing.
    let person: PdlPerson | null = null;
    try {
      person = await lookup(ident, clerkUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...emptyResult(this.name, this.tier, `pdl_lookup: ${msg}`),
        latencyMs: Date.now() - started,
        requestIdentifiers: { fullName: ident.fullName, domain: ident.domain },
      };
    }

    if (!person) {
      return {
        ...emptyResult(this.name, this.tier, "pdl_no_match"),
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
      person.work_email ??
      person.emails?.find((e) => e.type === "professional")?.address ??
      person.emails?.[0]?.address ??
      null;
    if (email) fields.email = mk(email); // gate verifies downstream
    if (person.job_title) fields.title = mk(person.job_title);
    const seniority = person.job_title_levels?.[0];
    if (seniority) fields.seniority = mk(seniority);
    if (person.job_company_name) fields.company = mk(person.job_company_name);
    if (person.linkedin_url) {
      const norm = person.linkedin_url.startsWith("http")
        ? person.linkedin_url
        : `https://${person.linkedin_url}`;
      fields.linkedin = mk(normalizeLinkedInUrl(norm) ?? norm);
    }

    const firmographics: Record<string, unknown> = {};
    const setFirmo = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && v !== "") firmographics[k] = v;
    };
    setFirmo("industry", person.job_company_industry);
    setFirmo("company_domain", person.job_company_website);
    setFirmo("contact_location", person.location_name);

    const success =
      Object.keys(fields).length > 0 || Object.keys(firmographics).length > 0;

    return {
      provider: this.name,
      tier: this.tier,
      success,
      fields,
      firmographics,
      emailVerification: null,
      // A returned record consumes a PDL credit regardless of field yield.
      costUsd: this.costPerCall,
      latencyMs: Date.now() - started,
      httpStatus: null,
      error: success ? null : "pdl_empty",
      requestIdentifiers: {
        fullName: ident.fullName,
        company: ident.company,
        domain: ident.domain,
        linkedinUrl: ident.linkedinUrl,
      },
    };
  }
}
