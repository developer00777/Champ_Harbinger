/**
 * Domain types for the Champ Harbinger waterfall enrichment engine.
 *
 * These are the in-memory, network-free types that flow through the waterfall:
 * Contact (the working record), FieldValue (one provenance-stamped field),
 * ProviderResult (what an adapter returns), and EnrichmentResult (the final
 * output of a job).
 *
 * Privacy note: minimalIdentifiers(contact) is the ONLY shape an external
 * provider is ever allowed to receive. The full Contact stays internal.
 */

import { createHash } from "node:crypto";

/**
 * Waterfall tiers, cost-ordered with owned tiers first.
 *
 * T0 and T1 are owned ($0). The email-verify GATE runs across all tiers on any
 * candidate email and is not itself a tier here. The tier is retained as a
 * coarse grouping for budgets and accept thresholds; escalation ORDER is the
 * config-driven provider priority list (see config.ts).
 */
export enum Tier {
  T0Master = "T0_master", // owned master DB / LakeB2B primary lookup
  T1Lakestream = "T1_lakestream", // owned scrape (WebExtraction/LinkedIn/X/SearXNG)
  T2Person = "T2_person", // Proxycurl, People Data Labs
  T3Heavy = "T3_heavy", // Apollo, ZoomInfo
  T4Reseller = "T4_reseller", // config-driven reseller waterfall
}

const TIER_ORDER: Record<Tier, number> = {
  [Tier.T0Master]: 0,
  [Tier.T1Lakestream]: 1,
  [Tier.T2Person]: 2,
  [Tier.T3Heavy]: 3,
  [Tier.T4Reseller]: 4,
};

/** Numeric rank for a tier (cheapest owned = 0). */
export function tierOrder(tier: Tier): number {
  return TIER_ORDER[tier];
}

/** All tiers from cheapest (owned) to most expensive. */
export function tiersInOrder(): Tier[] {
  return (Object.keys(TIER_ORDER) as Tier[]).sort(
    (a, b) => TIER_ORDER[a] - TIER_ORDER[b],
  );
}

/** Outcome of the email-verify gate, normalized across providers. */
export enum EmailVerdict {
  Deliverable = "deliverable",
  CatchAll = "catch_all",
  Undeliverable = "undeliverable",
  Unknown = "unknown",
}

/** Lifecycle of an enrichment job / contact record. */
export enum JobStatus {
  Queued = "queued",
  Running = "running",
  Accepted = "accepted",
  Exhausted = "exhausted",
  Failed = "failed",
}

/** Canonical contact fields the waterfall fills. */
export type CanonicalField =
  | "email"
  | "phone"
  | "title"
  | "seniority"
  | "linkedin"
  | (string & {});

/**
 * One provider in the config-driven escalation list (price x coverage).
 * The orchestrator iterates enabled entries by `rank` for fields still missing.
 */
export interface ProviderPriorityEntry {
  /** 'owned_scrape' | 'proxycurl' | 'pdl' | 'apollo' | 'zoominfo' | 'reseller:<id>' | 'lakeb2b' */
  name: string;
  enabled: boolean;
  /** USD per billable call; owned_scrape ~ 0 (OpenRouter tokens tracked separately). */
  costPerCall: number;
  /** Canonical fields this provider is good at. */
  covers: string[];
  /** Lower = tried earlier. */
  rank: number;
}

/**
 * A single field value with full provenance.
 *
 * confidence is base reliability * freshness decay * verification boost (see
 * confidence.ts). verified is true only when an authoritative check (owned
 * master record, or a passed email gate) backs it.
 */
export interface FieldValue {
  value: unknown;
  source: string;
  /** Confidence in [0,1]. */
  confidence: number;
  verified: boolean;
  /** When this value was observed (ISO string in storage, Date in memory). */
  observedAt: Date;
}

/** Normalized email-verify gate result mapped from any provider. */
export interface EmailVerification {
  email: string;
  verdict: EmailVerdict;
  catchAll: boolean;
  /** Provider deliverability score normalized to [0,1] when available. */
  score: number | null;
  provider: string;
}

/**
 * The working contact record threaded through the waterfall.
 *
 * `fields` is the canonical, field-level, best-value-wins store. Owned and
 * verified values are sticky (see mergeFields). `firmographics` holds
 * company-level attributes (industry, size, revenue band, etc.).
 */
export interface Contact {
  /** Harbinger contact UUID once persisted. */
  contactId: string | null;
  /** Caller-supplied reference (ChampSet row id, CRM id, etc.). */
  externalRef: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  /** Canonical field store keyed by field name. */
  fields: Record<string, FieldValue>;
  /** Company-level attributes (industry, size, revenue band, ...). */
  firmographics: Record<string, unknown>;
  /** Fraction of required fields present, [0,1]. */
  completenessScore: number;
  /** Gated weighted confidence over required fields, [0,1]. */
  confidenceScore: number;
  status: JobStatus;
}

/** The minimal identifier payload an external provider may receive. */
export interface MinimalIdentifiers {
  email: string | null;
  fullName: string | null;
  company: string | null;
  domain: string | null;
  linkedinUrl: string | null;
}

/** Create a seed Contact with sensible defaults. */
export function makeContact(seed: Partial<Contact> = {}): Contact {
  return {
    contactId: seed.contactId ?? null,
    externalRef: seed.externalRef ?? null,
    fullName: seed.fullName ?? null,
    firstName: seed.firstName ?? null,
    lastName: seed.lastName ?? null,
    company: seed.company ?? null,
    domain: seed.domain ?? null,
    linkedinUrl: seed.linkedinUrl ?? null,
    fields: seed.fields ?? {},
    firmographics: seed.firmographics ?? {},
    completenessScore: seed.completenessScore ?? 0,
    confidenceScore: seed.confidenceScore ?? 0,
    status: seed.status ?? JobStatus.Queued,
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

/** Raw value for a canonical field, or undefined if absent. */
export function getValue(contact: Contact, field: string): unknown {
  const fv = contact.fields[field];
  return fv ? fv.value : undefined;
}

/** True when a non-empty value exists for the canonical field. */
export function hasField(contact: Contact, field: string): boolean {
  const fv = contact.fields[field];
  return fv !== undefined && !emptyish(fv.value);
}

/**
 * The ONLY payload an external provider may receive.
 *
 * Strictly limited to email, full name, company name, company domain, and
 * LinkedIn URL. Company name is included because it is non-sensitive
 * firmographic context used to disambiguate the person; no other internal
 * field ever leaves.
 */
export function minimalIdentifiers(contact: Contact): MinimalIdentifiers {
  const email = getValue(contact, "email");
  const linkedinFromField = hasField(contact, "linkedin")
    ? String(getValue(contact, "linkedin"))
    : null;
  return {
    email: email ? String(email) : null,
    fullName: contact.fullName,
    company: contact.company,
    domain: contact.domain,
    linkedinUrl: contact.linkedinUrl ?? linkedinFromField,
  };
}

/**
 * Stable hash over the minimal identity, used as the cache key.
 *
 * Two contacts that resolve to the same person (same email, or same
 * name+domain) hash identically so the cache short-circuits duplicate provider
 * calls.
 */
export function identityHash(contact: Contact): string {
  const ident = minimalIdentifiers(contact);
  const basis = [
    (ident.email ?? "").toLowerCase(),
    (ident.linkedinUrl ?? "").toLowerCase(),
    (ident.fullName ?? "").toLowerCase(),
    (ident.domain ?? "").toLowerCase(),
  ].join("|");
  return createHash("sha256").update(basis, "utf8").digest("hex");
}

/**
 * What every adapter returns from fetch(). Adapters never throw out of fetch().
 *
 * `fields` are new FieldValues keyed by canonical name. `emailVerification` is
 * populated only by the verify gate. `costUsd` is charged only when the call
 * actually hit the provider (success or billable failure).
 */
export interface ProviderResult {
  provider: string;
  tier: Tier;
  success: boolean;
  fields: Record<string, FieldValue>;
  firmographics: Record<string, unknown>;
  emailVerification: EmailVerification | null;
  /** USD cost incurred by this call. */
  costUsd: number;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  /** The minimal identifiers actually sent (audit trail). */
  requestIdentifiers: Record<string, unknown>;
}

/** A no-cost, no-field result. Used when a key is missing or a call fails. */
export function emptyResult(
  provider: string,
  tier: Tier,
  error: string | null = null,
): ProviderResult {
  return {
    provider,
    tier,
    success: false,
    fields: {},
    firmographics: {},
    emailVerification: null,
    costUsd: 0,
    latencyMs: null,
    httpStatus: null,
    error,
    requestIdentifiers: {},
  };
}

/** Record of one tier execution within a job, for the result summary. */
export interface TierAttempt {
  tier: Tier;
  providersCalled: string[];
  accepted: boolean;
  costUsd: number;
  confidenceAfter: number;
}

/** Final output of an enrich job. Serialized to MCP / API structured content. */
export interface EnrichmentResult {
  contactId: string | null;
  externalRef: string | null;
  status: JobStatus;
  requiredFields: string[];
  resolvedTier: Tier | null;
  tiersAttempted: TierAttempt[];
  fields: Record<string, FieldValue>;
  firmographics: Record<string, unknown>;
  completenessScore: number;
  confidenceScore: number;
  totalCostUsd: number;
  masterWriteback: boolean;
  notes: string[];
}

/** A concise one-paragraph text summary to accompany structured content. */
export function summaryText(result: EnrichmentResult): string {
  const tierPath =
    result.tiersAttempted.map((a) => a.tier).join(" -> ") || "none";
  const resolved = result.resolvedTier ?? "unresolved";
  const present = result.requiredFields.filter((f) => f in result.fields);
  const missing = result.requiredFields.filter((f) => !(f in result.fields));
  const parts = [
    `Status: ${result.status}.`,
    `Resolved at: ${resolved}.`,
    `Tiers walked: ${tierPath}.`,
    `Required present: ${present.length ? present.join(", ") : "none"}.`,
  ];
  if (missing.length) {
    parts.push(`Still missing: ${missing.join(", ")}.`);
  }
  parts.push(
    `Confidence: ${result.confidenceScore.toFixed(2)}. Completeness: ${result.completenessScore.toFixed(2)}.`,
  );
  parts.push(`Spend: $${result.totalCostUsd.toFixed(4)}.`);
  if (result.masterWriteback) {
    parts.push("Verified fields written back to the owned master DB.");
  }
  return parts.join(" ");
}
