/**
 * Configuration for the Champ Harbinger waterfall enrichment engine.
 *
 * Tunables (thresholds, freshness decay, budgets, circuit-breaker, cache TTLs,
 * the provider priority list) live here with safe defaults and optional
 * environment overrides. Secrets (provider API keys) are NOT read here; they
 * are resolved per call via getUserApiKey() first, then an env fallback, inside
 * each provider adapter (see providers/keys.ts).
 *
 * Adapters that lack a key no-op gracefully, so the engine runs with only the
 * owned tiers (owned scrape + LLM extraction) configured. That is the
 * one-OpenRouter-key path.
 */

import type { ProviderPriorityEntry } from "./types";

/** A single reseller in the config-driven reseller waterfall. */
export interface ResellerEndpoint {
  name: string;
  baseUrl: string;
  authHeader: string;
  authValue: string;
  enrichPath: string;
  costPerCall: number;
  baseReliability: number;
  fieldMap: Record<string, string>;
}

/** Central settings object for the enrichment engine. */
export interface EnrichmentSettings {
  /** Optional DSN for an external LakeB2B master DB (future sync only). */
  masterDbDsn: string;

  // ZoomInfo base URL (credentials resolved per call).
  zoominfoBaseUrl: string;

  // Confidence / acceptance thresholds, per tier.
  acceptThreshold: Record<string, number>;
  freshnessHalfLifeDays: number;
  verificationBoost: number;
  catchAllEmailCap: number;

  // Budget caps.
  defaultJobBudgetUsd: number;
  perTierBudgetUsd: number;

  // Circuit breaker.
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;

  // Cache TTLs (seconds) per tier.
  cacheTtlSeconds: Record<string, number>;

  // HTTP.
  httpTimeoutMs: number;

  // Per-call provider costs (USD). Illustrative; override via env.
  providerCost: Record<string, number>;

  // Config-driven escalation order (price x coverage).
  providerPriority: ProviderPriorityEntry[];

  // Reseller waterfall, parsed from RESELLER_ENDPOINTS JSON.
  resellers: ResellerEndpoint[];
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

/**
 * Default provider priority list (owned/cheapest first, paid by typical price).
 *
 * LakeB2B is the PRIMARY source and is pinned ahead of this list by the
 * orchestrator (run right after the owned-master read); it is intentionally not
 * a ranked entry here. `enabled: true` reflects intent only - a paid adapter
 * still no-ops without its key, so paid tiers stay off in practice until a key
 * is configured. The product owner overrides this via PROVIDER_PRIORITY.
 */
const DEFAULT_PROVIDER_PRIORITY: ProviderPriorityEntry[] = [
  {
    name: "owned_scrape",
    enabled: true,
    costPerCall: 0,
    covers: ["email", "phone", "title", "seniority", "linkedin", "company"],
    rank: 10,
  },
  {
    name: "proxycurl",
    enabled: true,
    costPerCall: 0.03,
    covers: ["title", "seniority", "linkedin", "email", "company"],
    rank: 20,
  },
  {
    name: "pdl",
    enabled: true,
    costPerCall: 0.1,
    covers: ["email", "title", "seniority", "linkedin", "phone", "company"],
    rank: 30,
  },
  {
    name: "apollo",
    enabled: true,
    costPerCall: 0.2,
    covers: ["email", "phone", "title", "seniority", "linkedin", "company"],
    rank: 40,
  },
  {
    name: "zoominfo",
    enabled: true,
    costPerCall: 0.25,
    covers: ["email", "phone", "title", "seniority", "company"],
    rank: 50,
  },
];

/**
 * Parse PROVIDER_PRIORITY (a JSON array) into validated entries, sorted by rank.
 * Returns the defaults on missing/invalid JSON so the waterfall always has an
 * order. Each entry is sanitized field-by-field.
 */
export function parseProviderPriority(): ProviderPriorityEntry[] {
  const raw = process.env.PROVIDER_PRIORITY;
  if (!raw)
    return [...DEFAULT_PROVIDER_PRIORITY].sort((a, b) => a.rank - b.rank);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_PROVIDER_PRIORITY].sort((a, b) => a.rank - b.rank);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [...DEFAULT_PROVIDER_PRIORITY].sort((a, b) => a.rank - b.rank);
  }
  const out: ProviderPriorityEntry[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.name === "string") {
        out.push({
          name: o.name,
          enabled: typeof o.enabled === "boolean" ? o.enabled : true,
          costPerCall: typeof o.costPerCall === "number" ? o.costPerCall : 0,
          covers: Array.isArray(o.covers)
            ? (o.covers as unknown[]).filter(
                (c): c is string => typeof c === "string",
              )
            : [],
          rank: typeof o.rank === "number" ? o.rank : 100,
        });
      }
    }
  }
  if (out.length === 0) {
    return [...DEFAULT_PROVIDER_PRIORITY].sort((a, b) => a.rank - b.rank);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/**
 * Parse the RESELLER_ENDPOINTS env var (a JSON array) into validated
 * ResellerEndpoint objects. Returns an empty list (not an error) when nothing
 * is configured. Malformed JSON also yields an empty list rather than crashing.
 */
function parseResellers(): ResellerEndpoint[] {
  const raw = process.env.RESELLER_ENDPOINTS;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ResellerEndpoint[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.name === "string" && typeof o.baseUrl === "string") {
        out.push({
          name: o.name,
          baseUrl: o.baseUrl,
          authHeader:
            typeof o.authHeader === "string" ? o.authHeader : "Authorization",
          authValue: typeof o.authValue === "string" ? o.authValue : "",
          enrichPath:
            typeof o.enrichPath === "string" ? o.enrichPath : "/enrich",
          costPerCall: typeof o.costPerCall === "number" ? o.costPerCall : 0.1,
          baseReliability:
            typeof o.baseReliability === "number" ? o.baseReliability : 0.55,
          fieldMap:
            o.fieldMap && typeof o.fieldMap === "object"
              ? (o.fieldMap as Record<string, string>)
              : {},
        });
      }
    }
  }
  return out;
}

let cached: EnrichmentSettings | null = null;

/** Return a process-wide cached settings instance built from the environment. */
export function getSettings(): EnrichmentSettings {
  if (cached) return cached;
  cached = {
    masterDbDsn: strEnv("LAKEB2B_MASTER_DSN", ""),
    zoominfoBaseUrl: strEnv("ZOOMINFO_BASE_URL", "https://api.zoominfo.com"),

    acceptThreshold: {
      ["T0_master"]: numEnv("ACCEPT_THRESHOLD_T0", 0.8),
      ["T1_lakestream"]: numEnv("ACCEPT_THRESHOLD_T1", 0.72),
      ["T2_person"]: numEnv("ACCEPT_THRESHOLD_T2", 0.66),
      ["T3_heavy"]: numEnv("ACCEPT_THRESHOLD_T3", 0.6),
      ["T4_reseller"]: numEnv("ACCEPT_THRESHOLD_T4", 0.5),
    },
    freshnessHalfLifeDays: numEnv("FRESHNESS_HALF_LIFE_DAYS", 180),
    verificationBoost: numEnv("VERIFICATION_BOOST", 1.15),
    catchAllEmailCap: numEnv("CATCH_ALL_EMAIL_CAP", 0.55),

    defaultJobBudgetUsd: numEnv("DEFAULT_JOB_BUDGET_USD", 1.0),
    perTierBudgetUsd: numEnv("PER_TIER_BUDGET_USD", 0.5),

    circuitBreakerThreshold: numEnv("CIRCUIT_BREAKER_THRESHOLD", 3),
    circuitBreakerCooldownMs: numEnv("CIRCUIT_BREAKER_COOLDOWN_MS", 300_000),

    cacheTtlSeconds: {
      ["T0_master"]: numEnv("CACHE_TTL_MASTER_S", 86_400),
      ["T1_lakestream"]: numEnv("CACHE_TTL_SCRAPE_S", 43_200),
      ["T2_person"]: numEnv("CACHE_TTL_PERSON_S", 604_800),
      ["T3_heavy"]: numEnv("CACHE_TTL_HEAVY_S", 604_800),
      ["T4_reseller"]: numEnv("CACHE_TTL_RESELLER_S", 259_200),
      ["email_verify"]: numEnv("CACHE_TTL_EMAIL_VERIFY_S", 2_592_000),
    },

    httpTimeoutMs: numEnv("ENRICHMENT_HTTP_TIMEOUT_MS", 30_000),

    providerCost: {
      proxycurl: numEnv("COST_PROXYCURL", 0.03),
      pdl: numEnv("COST_PDL", 0.1),
      apollo: numEnv("COST_APOLLO", 0.2),
      zoominfo: numEnv("COST_ZOOMINFO", 0.25),
    },

    providerPriority: parseProviderPriority(),
    resellers: parseResellers(),
  };
  return cached;
}

/** Reset the cached settings. Test-only convenience. */
export function resetSettingsCache(): void {
  cached = null;
}
