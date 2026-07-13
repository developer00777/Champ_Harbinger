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
 * Apollo.io people-enrichment adapter (paid data API, waterfall tier T2).
 *
 * Runs only for fields still missing after the owned tiers + LakeB2B, and only
 * when an Apollo key is configured (env APOLLO_API_KEY or per-user BYOK
 * apollo_api_key). Bills costPerCall only when a record is returned (Apollo
 * charges per enriched record), so a no-match or error is free. Only
 * minimalIdentifiers leave for the match. The lookup is INJECTED so the mapping
 * is unit-testable without network.
 *
 * API: POST https://api.apollo.io/api/v1/people/match (query params, header
 * `x-api-key`). Returns `{ person: {...} }`.
 */

const SUPPLIABLE = new Set([
  "email",
  "title",
  "seniority",
  "linkedin",
  "company",
]);
const MATCH_ENDPOINT = "https://api.apollo.io/api/v1/people/match";

export interface ApolloPerson {
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  seniority?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: {
    name?: string;
    website_url?: string;
    primary_domain?: string;
    industry?: string;
  } | null;
}

export type ApolloLookupFn = (
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    email: string | null;
  },
  clerkUserId?: string,
) => Promise<ApolloPerson | null>;

export interface ApolloAdapterDeps {
  lookup?: ApolloLookupFn;
  isConfigured?: (clerkUserId?: string) => Promise<boolean>;
}

/** Apollo returns a placeholder when an email is locked; treat that as absent. */
function realEmail(email: string | undefined): string | null {
  if (!email) return null;
  if (!email.includes("@")) return null;
  if (/email_not_unlocked|notunlocked|domain\.com$/i.test(email)) return null;
  return email;
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
): Promise<ApolloPerson | null> {
  const key = await resolveProviderKey(
    "apollo_api_key",
    process.env.APOLLO_API_KEY,
    clerkUserId,
  );
  if (!key) return null;

  const params = new URLSearchParams();
  if (ident.email) params.set("email", ident.email);
  if (ident.linkedinUrl) params.set("linkedin_url", ident.linkedinUrl);
  if (ident.fullName) params.set("name", ident.fullName);
  if (ident.company) params.set("organization_name", ident.company);
  if (ident.domain) params.set("domain", ident.domain);
  if ([...params.keys()].length === 0) return null;

  const res = await fetchWithTimeout(
    `${MATCH_ENDPOINT}?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": key,
      },
    },
    30_000,
  );
  if (!res.ok) {
    throw new Error(`Apollo ${res.status}`);
  }
  const data = (await res.json()) as { person?: ApolloPerson | null };
  return data.person ?? null;
}

async function defaultIsConfigured(clerkUserId?: string): Promise<boolean> {
  const key = await resolveProviderKey(
    "apollo_api_key",
    process.env.APOLLO_API_KEY,
    clerkUserId,
  );
  return key !== null;
}

export class ApolloAdapter implements ProviderAdapter {
  readonly tier = Tier.T2Person;
  readonly name = "apollo";
  readonly costPerCall: number;
  private readonly deps: ApolloAdapterDeps;

  constructor(deps: ApolloAdapterDeps = {}) {
    this.deps = deps;
    this.costPerCall = Number(process.env.COST_APOLLO) || 0.2;
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

    // Apollo bills a credit only when a record is returned, so a failed call or
    // a no-match costs nothing (costUsd stays 0).
    let person: ApolloPerson | null = null;
    try {
      person = await lookup(ident, clerkUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...emptyResult(this.name, this.tier, `apollo_lookup: ${msg}`),
        latencyMs: Date.now() - started,
        requestIdentifiers: { fullName: ident.fullName, domain: ident.domain },
      };
    }

    if (!person) {
      return {
        ...emptyResult(this.name, this.tier, "apollo_no_match"),
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

    const email = realEmail(person.email);
    if (email) fields.email = mk(email); // gate verifies downstream
    if (person.title) fields.title = mk(person.title);
    if (person.seniority) fields.seniority = mk(person.seniority);
    if (person.organization?.name)
      fields.company = mk(person.organization.name);
    if (person.linkedin_url) {
      fields.linkedin = mk(
        normalizeLinkedInUrl(person.linkedin_url) ?? person.linkedin_url,
      );
    }

    const firmographics: Record<string, unknown> = {};
    const setFirmo = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && v !== "") firmographics[k] = v;
    };
    setFirmo("industry", person.organization?.industry);
    setFirmo(
      "company_domain",
      person.organization?.primary_domain ?? person.organization?.website_url,
    );
    const loc = [person.city, person.state, person.country]
      .filter(Boolean)
      .join(", ");
    setFirmo("contact_location", loc || undefined);

    const success =
      Object.keys(fields).length > 0 || Object.keys(firmographics).length > 0;

    return {
      provider: this.name,
      tier: this.tier,
      success,
      fields,
      firmographics,
      emailVerification: null,
      costUsd: this.costPerCall,
      latencyMs: Date.now() - started,
      httpStatus: null,
      error: success ? null : "apollo_empty",
      requestIdentifiers: {
        fullName: ident.fullName,
        company: ident.company,
        domain: ident.domain,
        linkedinUrl: ident.linkedinUrl,
      },
    };
  }
}
