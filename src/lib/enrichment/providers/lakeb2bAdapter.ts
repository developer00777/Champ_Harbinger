import "server-only";

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
import {
  linkedinUrlMatchesSeed,
  normalizeLinkedInUrl,
} from "./linkedinResolver";
import type { Company, Person } from "@/lib/lakeb2b/schemas";

/**
 * LakeB2B primary-source adapter for the waterfall.
 *
 * LakeB2B is the pinned primary (orchestrator.PINNED_PRIMARY): it supplies the
 * identity/contact/firmographic backbone (email, title, LinkedIn URL, company,
 * location, firmographics) that the owned LinkedIn/web scrape then augments with
 * personalization content. The two are additive by construction — LakeB2B and
 * owned_scrape write mostly different fields, and mergeFields resolves any
 * overlap by verified -> confidence -> recency.
 *
 * Only minimalIdentifiers ever leave for the lookup. The lookup is INJECTED so
 * this is unit-testable without network; production lazy-imports the real
 * LakeB2B client (live when LAKEB2B_API_URL + key are set, mock otherwise).
 */

const SUPPLIABLE = new Set(["email", "title", "linkedin", "company"]);

/** What the injected lookup returns for a resolved person. */
export interface LakeB2BMatch {
  person: Person;
  company?: Company | null;
}

export type LakeB2BLookupFn = (
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
  },
  clerkUserId?: string,
) => Promise<LakeB2BMatch | null>;

export interface LakeB2BAdapterDeps {
  lookup?: LakeB2BLookupFn;
  /** Whether the adapter should run. Defaults to real-key OR explicit mock. */
  isConfigured?: (clerkUserId?: string) => Promise<boolean>;
}

function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normName(name: string | undefined | null): string {
  return stripDiacritics(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the LakeB2B person that actually matches the seed, conservatively.
 * LinkedIn URL match wins; otherwise exact full-name match, and when the
 * candidate carries a LinkedIn URL its slug must contain the seed surname
 * (linkedinUrlMatchesSeed) so we never attach a same-name stranger.
 */
export function pickBestMatch(
  candidates: Person[],
  seed: {
    fullName: string | null;
    company: string | null;
    linkedinUrl: string | null;
  },
): Person | null {
  if (candidates.length === 0) return null;

  const seedLi = seed.linkedinUrl
    ? normalizeLinkedInUrl(seed.linkedinUrl)
    : null;
  if (seedLi) {
    const byLi = candidates.find(
      (c) => c.linkedin_url && normalizeLinkedInUrl(c.linkedin_url) === seedLi,
    );
    if (byLi) return byLi;
  }

  if (!seed.fullName) return null;
  const seedName = normName(seed.fullName);
  const seedCompany = normName(seed.company);

  const nameMatches = candidates.filter(
    (c) => normName(c.full_name) === seedName,
  );
  if (nameMatches.length === 0) return null;

  // Prefer a company-consistent match when we know the company.
  const ranked = seedCompany
    ? [
        ...nameMatches.filter((c) =>
          normName(c.company_name).includes(seedCompany),
        ),
        ...nameMatches.filter(
          (c) => !normName(c.company_name).includes(seedCompany),
        ),
      ]
    : nameMatches;

  for (const candidate of ranked) {
    // If the candidate has a LinkedIn URL, it must plausibly be this person.
    if (
      candidate.linkedin_url &&
      !linkedinUrlMatchesSeed(candidate.linkedin_url, {
        fullName: seed.fullName,
      })
    ) {
      continue;
    }
    return candidate;
  }
  return null;
}

/** Default production lookup: real LakeB2B client (live or mock). */
async function defaultLookup(
  ident: {
    fullName: string | null;
    company: string | null;
    domain: string | null;
    linkedinUrl: string | null;
  },
  clerkUserId?: string,
): Promise<LakeB2BMatch | null> {
  if (!ident.fullName) return null;
  const { getLakeB2BClient } = await import("@/lib/lakeb2b/client");
  const client = await getLakeB2BClient(clerkUserId);

  const people = await client.searchPeople({
    q: ident.fullName,
    page: 1,
    per_page: 25,
  });
  const person = pickBestMatch(people.results, {
    fullName: ident.fullName,
    company: ident.company,
    linkedinUrl: ident.linkedinUrl,
  });
  if (!person) return null;

  let company: Company | null = null;
  const companyQ = person.company_name ?? ident.company ?? null;
  if (companyQ) {
    try {
      const companies = await client.searchCompanies({
        q: companyQ,
        page: 1,
        per_page: 5,
      });
      company =
        companies.results.find(
          (c) => normName(c.name) === normName(companyQ),
        ) ??
        companies.results[0] ??
        null;
    } catch {
      company = null;
    }
  }
  return { person, company };
}

async function defaultIsConfigured(clerkUserId?: string): Promise<boolean> {
  // Enabled when a real key is present, or when mock is explicitly on so the
  // primary source can be validated end-to-end against the mock dataset.
  if (process.env.LAKEB2B_MOCK === "true") return true;
  const { hasLakeB2BKey } = await import("@/lib/lakeb2b/client");
  return hasLakeB2BKey(clerkUserId);
}

export class LakeB2BAdapter implements ProviderAdapter {
  readonly tier = Tier.T0Master;
  readonly name = "lakeb2b";
  readonly costPerCall: number;
  private readonly deps: LakeB2BAdapterDeps;

  constructor(deps: LakeB2BAdapterDeps = {}) {
    this.deps = deps;
    // Mock runs are free; a real key incurs the configured per-call cost.
    this.costPerCall =
      process.env.LAKEB2B_MOCK === "true"
        ? 0
        : Number(process.env.COST_LAKEB2B) || 0.08;
  }

  canSupply(requiredFields: string[]): boolean {
    return requiredFields.some((f) => SUPPLIABLE.has(f));
  }

  isEnabled(
    _settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<boolean> {
    const check = this.deps.isConfigured ?? defaultIsConfigured;
    return check(clerkUserId);
  }

  async fetch(
    contact: Contact,
    settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<ProviderResult> {
    const started = Date.now();
    const ident = minimalIdentifiers(contact);
    const lookup = this.deps.lookup ?? defaultLookup;

    let match: LakeB2BMatch | null = null;
    try {
      match = await lookup(
        {
          fullName: ident.fullName,
          company: ident.company,
          domain: ident.domain,
          linkedinUrl: ident.linkedinUrl,
        },
        clerkUserId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...emptyResult(this.name, this.tier, `lakeb2b_lookup: ${msg}`),
        // A failed call to a paid provider is still billable.
        costUsd: this.costPerCall,
        latencyMs: Date.now() - started,
        requestIdentifiers: {
          fullName: ident.fullName,
          company: ident.company,
        },
      };
    }

    if (!match) {
      return {
        ...emptyResult(this.name, this.tier, "lakeb2b_no_match"),
        costUsd: this.costPerCall,
        latencyMs: Date.now() - started,
        requestIdentifiers: {
          fullName: ident.fullName,
          company: ident.company,
        },
      };
    }

    const { person, company } = match;
    const fields: Record<string, FieldValue> = {};
    const mk = (value: unknown, verified = false): FieldValue =>
      buildFieldValue({ value, provider: this.name, settings, verified });

    if (person.email) fields.email = mk(person.email); // gate verifies downstream
    if (person.title) fields.title = mk(person.title);
    if (person.company_name) fields.company = mk(person.company_name);
    if (person.linkedin_url) {
      const norm = normalizeLinkedInUrl(person.linkedin_url);
      // A vendor-supplied LinkedIn URL keyed to the matched record is trusted.
      fields.linkedin = mk(norm ?? person.linkedin_url, true);
    }

    const firmographics: Record<string, unknown> = {};
    const setFirmo = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && v !== "") firmographics[k] = v;
    };
    if (person.location) setFirmo("contact_location", person.location);
    if (company) {
      setFirmo("company_name", company.name);
      setFirmo("industry", company.industry);
      setFirmo("employee_count", company.employee_count);
      setFirmo("employee_range", company.employee_range);
      setFirmo("funding_stage", company.funding_stage);
      setFirmo("funding_total_usd", company.funding_total_usd);
      setFirmo("founded_year", company.founded_year);
      setFirmo("technologies", company.technologies);
      setFirmo("company_location", company.location);
      setFirmo("company_description", company.description);
    }

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
      error: success ? null : "lakeb2b_empty",
      requestIdentifiers: {
        fullName: ident.fullName,
        company: ident.company,
        domain: ident.domain,
        linkedinUrl: ident.linkedinUrl,
      },
    };
  }
}
