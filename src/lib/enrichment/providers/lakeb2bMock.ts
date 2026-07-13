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

/**
 * T0 pinned-primary adapter — a deterministic MOCK of the LakeB2B API.
 *
 * The real LakeB2B people/enrichment API is the load-bearing dependency
 * (blocked on the API contract from Sundar, spec §7). Until it lands, this mock
 * matches the ProviderAdapter interface so the whole tool — discover, waterfall,
 * persist, results, sync — is built and demoable end to end with LakeB2B pinned
 * first. The real adapter drops in behind the same interface with no orchestrator
 * change.
 *
 * It is DISABLED unless explicitly turned on (LAKEB2B_MOCK truthy or constructed
 * `enabled: true`), so production/owned-only runs are never touched by mock data.
 * All values are derived deterministically from the contact's minimal identifiers
 * (never the full Contact), so a run is reproducible and privacy-preserving.
 */

const SUPPLIABLE = new Set([
  "email",
  "phone",
  "title",
  "seniority",
  "linkedin",
  "company",
]);

const TITLES = [
  "Chief Financial Officer",
  "VP of Finance",
  "Head of Treasury",
  "Finance Director",
  "Controller",
];
const SENIORITIES = ["c_level", "vp", "head", "director", "manager"];
const INDUSTRIES = [
  "Financial Services",
  "SaaS",
  "Manufacturing",
  "Healthcare",
  "Retail",
];
const EMPLOYEE_RANGES = ["11-50", "51-200", "201-500", "501-1000", "1001-5000"];

export interface MockLakeB2BDeps {
  /** Force enable/disable; defaults to the LAKEB2B_MOCK env flag. */
  enabled?: boolean;
}

function envEnabled(): boolean {
  const raw = (process.env.LAKEB2B_MOCK ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Strip scheme / www / path so a messy domain resolves to a bare host. */
function normalizeDomain(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
  return host || null;
}

/** Lowercase alphanumeric name tokens, e.g. "John Q. Smith" -> ["john","q","smith"]. */
function nameTokens(fullName: string | null): string[] {
  if (!fullName) return [];
  return fullName
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 0);
}

/** Deterministic non-negative hash over a string. */
function hashNum(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class MockLakeB2BAdapter implements ProviderAdapter {
  readonly tier = Tier.T0Master;
  readonly name = "lakeb2b";
  readonly costPerCall = 0;
  private readonly enabled: boolean;

  constructor(deps: MockLakeB2BDeps = {}) {
    this.enabled = deps.enabled ?? envEnabled();
  }

  canSupply(requiredFields: string[]): boolean {
    return requiredFields.some((f) => SUPPLIABLE.has(f));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async fetch(
    contact: Contact,
    settings: EnrichmentSettings,
  ): Promise<ProviderResult> {
    const ident = minimalIdentifiers(contact);
    const domain = normalizeDomain(ident.domain);
    const tokens = nameTokens(ident.fullName);

    // No stable identity -> LakeB2B has nothing to return.
    if (tokens.length === 0 && !domain) {
      return emptyResult(this.name, this.tier, "lakeb2b_mock_no_identity");
    }

    const fields: Record<string, FieldValue> = {};
    const mk = (value: unknown, verified: boolean): FieldValue =>
      buildFieldValue({ value, provider: this.name, settings, verified });

    if (tokens.length > 0 && domain) {
      const local =
        tokens.length === 1
          ? tokens[0]
          : `${tokens[0]}.${tokens[tokens.length - 1]}`;
      fields.email = mk(`${local}@${domain}`, true);
    }

    if (tokens.length > 0) {
      fields.linkedin = mk(
        `https://www.linkedin.com/in/${tokens.join("-")}`,
        true,
      );
    }

    const seed = hashNum(`${tokens.join(" ")}|${domain ?? ""}`);
    const titleIdx = seed % TITLES.length;
    fields.title = mk(TITLES[titleIdx], true);
    fields.seniority = mk(SENIORITIES[titleIdx], true);
    fields.phone = mk(`+1-555-${String(1000 + (seed % 9000))}`, true);

    const firmographics: Record<string, unknown> = {
      industry: INDUSTRIES[seed % INDUSTRIES.length],
      employeeRange: EMPLOYEE_RANGES[(seed >> 3) % EMPLOYEE_RANGES.length],
    };

    return {
      provider: this.name,
      tier: this.tier,
      success: Object.keys(fields).length > 0,
      fields,
      firmographics,
      emailVerification: null,
      costUsd: 0,
      latencyMs: 0,
      httpStatus: 200,
      error: null,
      // Only the minimal, non-sensitive identifiers were used.
      requestIdentifiers: { fullName: ident.fullName, domain },
    };
  }
}
