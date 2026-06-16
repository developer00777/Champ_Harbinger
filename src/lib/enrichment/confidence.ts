/**
 * Confidence model and field merge logic for the waterfall.
 *
 * Each field carries confidence = baseReliability * freshnessDecay *
 * verificationBoost, clamped to [0,1]. This module is pure and network-free so
 * it is trivially unit-testable.
 */

import type { EnrichmentSettings } from "./config";
import { EmailVerdict, type FieldValue } from "./types";

/**
 * Per-provider base reliability priors (0..1). Owned/authoritative sources
 * score highest. These are deliberately conservative; verification can boost an
 * email above its base, and freshness pulls everything down with age.
 */
export const PROVIDER_BASE_RELIABILITY: Record<string, number> = {
  // Owned / primary
  lakeb2b: 0.92, // LakeB2B data API (primary source when configured)
  owned_master: 0.95, // our own verified master record
  owned_scrape: 0.7, // owned LLM scrape, good but unverified by default
  caller_input: 0.6, // seed identifiers from the caller
  // Email verify gate (sets verification, not field values directly)
  owned_email_gate: 0.9,
  neverbounce: 0.92,
  zerobounce: 0.88,
  hunter: 0.82,
  // Optional paid person/heavy providers
  proxycurl: 0.85,
  pdl: 0.8,
  apollo: 0.78,
  zoominfo: 0.86,
  // Reseller default; per-reseller override comes from config.
  reseller: 0.55,
};

/** Default prior for any provider not listed above. */
export const DEFAULT_BASE_RELIABILITY = 0.5;

export function clamp(x: number, lo = 0, hi = 1): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Return the base reliability prior for a provider. `override` lets
 * config-driven resellers pass their own value. Result clamped to [0,1].
 */
export function baseReliability(provider: string, override?: number): number {
  if (override !== undefined && override !== null) {
    return clamp(override);
  }
  // reseller:<id> providers share the reseller prior unless overridden.
  if (provider.startsWith("reseller:")) {
    return clamp(PROVIDER_BASE_RELIABILITY.reseller);
  }
  return clamp(PROVIDER_BASE_RELIABILITY[provider] ?? DEFAULT_BASE_RELIABILITY);
}

/**
 * Exponential freshness decay based on age of the observation.
 *
 * factor = 0.5 ** (ageDays / halfLifeDays), clamped to [0,1]. A value observed
 * today scores ~1.0; one observed at the configured half-life scores 0.5;
 * older values decay further. Future timestamps clamp to 1.0.
 */
export function freshnessDecay(
  observedAt: Date,
  settings: EnrichmentSettings,
  now: Date = new Date(),
): number {
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  const ageDays = ageMs / 86_400_000;
  const halfLife = Math.max(1, settings.freshnessHalfLifeDays);
  const factor = Math.pow(0.5, ageDays / halfLife);
  return clamp(factor);
}

/**
 * Combine base reliability, freshness decay, and verification boost.
 *
 * The verification boost only applies when `verified` is true (for example an
 * email that passed the deliverability gate, or a value from the owned master
 * DB). Result clamped to [0,1].
 */
export function computeConfidence(args: {
  provider: string;
  observedAt: Date;
  settings: EnrichmentSettings;
  verified?: boolean;
  reliabilityOverride?: number;
  now?: Date;
}): number {
  const base = baseReliability(args.provider, args.reliabilityOverride);
  const fresh = freshnessDecay(args.observedAt, args.settings, args.now);
  const boost = args.verified ? args.settings.verificationBoost : 1.0;
  return clamp(base * fresh * boost);
}

/**
 * Construct a FieldValue with confidence computed from the model. Convenience
 * used by every adapter so confidence math lives in exactly one place.
 */
export function buildFieldValue(args: {
  value: unknown;
  provider: string;
  settings: EnrichmentSettings;
  observedAt?: Date;
  verified?: boolean;
  reliabilityOverride?: number;
}): FieldValue {
  const observedAt = args.observedAt ?? new Date();
  const confidence = computeConfidence({
    provider: args.provider,
    observedAt,
    settings: args.settings,
    verified: args.verified,
    reliabilityOverride: args.reliabilityOverride,
  });
  return {
    value: args.value,
    source: args.provider,
    confidence,
    verified: Boolean(args.verified),
    observedAt,
  };
}

/**
 * Adjust an email FieldValue based on the verify-gate verdict.
 *
 * - Deliverable: mark verified and apply the verification boost.
 * - CatchAll: cap confidence at the configured catch_all cap, not verified.
 * - Undeliverable: return null so the caller discards the email and escalates.
 * - Unknown: leave confidence unchanged, not verified.
 *
 * Returns a new FieldValue (or null to discard). Pure: no mutation of input.
 */
export function applyEmailGate(
  emailField: FieldValue,
  verdict: EmailVerdict,
  settings: EnrichmentSettings,
): FieldValue | null {
  if (verdict === EmailVerdict.Undeliverable) {
    return null;
  }

  let newConf = emailField.confidence;
  let verified = emailField.verified;

  if (verdict === EmailVerdict.Deliverable) {
    verified = true;
    newConf = clamp(emailField.confidence * settings.verificationBoost);
  } else if (verdict === EmailVerdict.CatchAll) {
    verified = false;
    newConf = Math.min(emailField.confidence, settings.catchAllEmailCap);
  }
  // Unknown: no change.

  return {
    value: emailField.value,
    source: emailField.source,
    confidence: newConf,
    verified,
    observedAt: emailField.observedAt,
  };
}

function emptyish(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Resolve a genuine value conflict between two observations of the same field.
 *
 * Recency wins: the live owned scrape is stamped now() and is usually the most
 * current truth, so it overrides an older LakeB2B / vendor value even if that
 * value carries higher raw confidence. Ties break on confidence, then on the
 * verified flag. Pure: returns whichever input wins, never a new object.
 *
 * Used by mergeFields for true value disagreements and by the LakeB2B adapter
 * phase when reconciling vendor data against the live LinkedIn scrape.
 */
export function resolveConflict(a: FieldValue, b: FieldValue): FieldValue {
  const at = a.observedAt.getTime();
  const bt = b.observedAt.getTime();
  if (at !== bt) return at > bt ? a : b;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.verified && !b.verified ? a : b;
}

/**
 * Ordering used by merge when values are EQUAL or one side is absent: verified
 * beats unverified, then higher confidence, then more recent observation.
 * Returns true when `a` ranks at least as high.
 */
function ranksHigherOrEqual(a: FieldValue, b: FieldValue): boolean {
  const av = a.verified ? 1 : 0;
  const bv = b.verified ? 1 : 0;
  if (av !== bv) return av > bv;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  return a.observedAt.getTime() >= b.observedAt.getTime();
}

/** True when two field values represent the same underlying value. */
function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Object.is(a.value, b.value)) return true;
  if (typeof a.value === "string" && typeof b.value === "string") {
    return a.value.trim().toLowerCase() === b.value.trim().toLowerCase();
  }
  return false;
}

/**
 * Field-level, best-value-wins merge with sticky owned/verified values and
 * recency-based conflict resolution.
 *
 * For each key present in `incoming`:
 *   - if not in `existing`, take it.
 *   - if the values AGREE: keep whichever ranks higher by (verified, confidence,
 *     recency); a verified existing value is sticky over an unverified incoming.
 *   - if the values genuinely DISAGREE: resolve by recency (resolveConflict) so
 *     the freshest observation wins. This is the LakeB2B-vs-live-scrape rule.
 *
 * Returns a NEW object; inputs are not mutated.
 */
export function mergeFields(
  existing: Record<string, FieldValue>,
  incoming: Record<string, FieldValue>,
): Record<string, FieldValue> {
  const merged: Record<string, FieldValue> = { ...existing };
  for (const [key, inc] of Object.entries(incoming)) {
    const cur = merged[key];
    if (cur === undefined) {
      merged[key] = inc;
      continue;
    }
    if (sameValue(cur, inc)) {
      // Agreement: sticky verified, else higher rank wins.
      if (cur.verified && !inc.verified) continue;
      merged[key] = ranksHigherOrEqual(cur, inc) ? cur : inc;
      continue;
    }
    // Genuine conflict: freshest observation wins.
    merged[key] = resolveConflict(cur, inc);
  }
  return merged;
}

/**
 * Gated weighted-average confidence over the required fields.
 *
 * The gate: if ANY required field is missing, its contribution is 0, which
 * pulls the average down and forces escalation. So a record cannot clear an
 * accept threshold while a required field is absent. Weighting is uniform.
 */
export function recordConfidence(
  fields: Record<string, FieldValue>,
  requiredFields: string[],
): number {
  if (requiredFields.length === 0) return 0;
  let total = 0;
  for (const f of requiredFields) {
    const fv = fields[f];
    if (fv === undefined || emptyish(fv.value)) {
      total += 0; // missing required field contributes nothing
    } else {
      total += clamp(fv.confidence);
    }
  }
  return clamp(total / requiredFields.length);
}

/** Fraction of required fields that have a non-empty value, in [0,1]. */
export function completeness(
  fields: Record<string, FieldValue>,
  requiredFields: string[],
): number {
  if (requiredFields.length === 0) return 0;
  let present = 0;
  for (const f of requiredFields) {
    const fv = fields[f];
    if (fv !== undefined && !emptyish(fv.value)) present += 1;
  }
  return clamp(present / requiredFields.length);
}
