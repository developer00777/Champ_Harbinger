import {
  applyEmailGate,
  completeness,
  mergeFields,
  recordConfidence,
} from "./confidence";
import type { EnrichmentSettings } from "./config";
import {
  ProviderRegistry,
  safeFetch,
  type ProviderAdapter,
} from "./providers/base";
import {
  hasField,
  identityHash,
  JobStatus,
  minimalIdentifiers,
  Tier,
  tierOrder,
  type Contact,
  type EmailVerification,
  type EnrichmentResult,
  type FieldValue,
  type ProviderResult,
  type TierAttempt,
} from "./types";

/**
 * WaterfallOrchestrator: the owned-first, priority-list-driven escalation engine.
 *
 * Order of operations for one contact:
 *   1. Gate any seed email up front (undeliverable seed is discarded).
 *   2. If the seed/owned data already satisfies the required fields above the
 *      T0 accept threshold, accept with no provider calls or spend.
 *   3. Run the PINNED PRIMARY source (LakeB2B) when registered + enabled - it is
 *      the production-primary and runs ahead of the configurable list. (Until
 *      the LakeB2B adapter is registered this is a no-op, so owned-only works.)
 *   4. Escalate through registry.orderedFor(missingRequired) - the config-driven
 *      provider priority list (price x coverage) - calling each, merging
 *      best-value-wins with recency conflict resolution, re-gating any new email,
 *      and stopping at the FIRST provider after which the required fields are
 *      present and the gated record confidence meets that provider tier's accept
 *      threshold.
 *
 * Also stops when: per-job budget exhausted, a tier's budget exhausted (that
 * provider skipped), maxTier reached, or the list is exhausted. Every provider
 * call is logged via an injected async logger. A per-provider circuit breaker
 * blocks providers that have failed repeatedly.
 *
 * Network-free at its own level: depends on the ProviderRegistry (adapters
 * injected), an email-verify callable, a cache get/set pair, and an audit-log
 * callable. Tests pass fakes for all of these.
 */

export const DEFAULT_REQUIRED_FIELDS: string[] = ["email", "title", "company"];

/** Providers tried ahead of the configurable list (production-primary source). */
const PINNED_PRIMARY: string[] = ["lakeb2b"];

export type EmailVerifyFn = (
  email: string,
  settings: EnrichmentSettings,
) => Promise<EmailVerification | null>;
export type CacheGetFn = (
  identityHash: string,
  provider: string,
) => Promise<ProviderResult | null>;
export type CacheSetFn = (
  identityHash: string,
  result: ProviderResult,
  settings: EnrichmentSettings,
) => Promise<void>;
export type AuditLogFn = (row: Record<string, unknown>) => Promise<void>;

export interface OrchestratorDeps {
  registry: ProviderRegistry;
  settings: EnrichmentSettings;
  verifyEmail?: EmailVerifyFn;
  cacheGet?: CacheGetFn;
  cacheSet?: CacheSetFn;
  auditLog?: AuditLogFn;
  clerkUserId?: string;
}

export interface RunOptions {
  requiredFields?: string[];
  maxTier?: Tier;
  budgetUsd?: number | null;
  jobId?: string | null;
}

function acceptThreshold(tier: Tier, settings: EnrichmentSettings): number {
  return (
    settings.acceptThreshold[tier] ?? settings.acceptThreshold[Tier.T3Heavy]
  );
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export class WaterfallOrchestrator {
  private readonly registry: ProviderRegistry;
  private readonly settings: EnrichmentSettings;
  private readonly verify: EmailVerifyFn;
  private readonly cacheGet: CacheGetFn;
  private readonly cacheSet: CacheSetFn;
  private readonly audit: AuditLogFn;
  private readonly clerkUserId?: string;

  constructor(deps: OrchestratorDeps) {
    this.registry = deps.registry;
    this.settings = deps.settings;
    this.verify = deps.verifyEmail ?? (async () => null);
    this.cacheGet = deps.cacheGet ?? (async () => null);
    this.cacheSet = deps.cacheSet ?? (async () => undefined);
    this.audit = deps.auditLog ?? (async () => undefined);
    this.clerkUserId = deps.clerkUserId;
  }

  async run(
    contact: Contact,
    options: RunOptions = {},
  ): Promise<EnrichmentResult> {
    const required = options.requiredFields ?? [...DEFAULT_REQUIRED_FIELDS];
    const maxTier = options.maxTier ?? Tier.T4Reseller;
    const jobBudget =
      options.budgetUsd === undefined || options.budgetUsd === null
        ? this.settings.defaultJobBudgetUsd
        : options.budgetUsd;
    const jobId = options.jobId ?? null;

    contact.status = JobStatus.Running;
    const attemptsByTier = new Map<Tier, TierAttempt>();
    const tierSpend = new Map<Tier, number>();
    const notes: string[] = [];
    const called = new Set<string>();
    let totalCost = 0;
    let resolvedTier: Tier | null = null;
    let accepted = false;

    const ctx = {
      attemptsByTier,
      tierSpend,
      notes,
      called,
      jobBudget,
      maxTier,
      jobId,
      required,
    };

    // 1. Gate any seed email; recompute scores.
    await this.gateExistingEmail(contact, notes);
    this.recompute(contact, required);

    // 2. Accept immediately if owned/seed data already clears the T0 bar.
    if (this.isAcceptable(contact, required, Tier.T0Master)) {
      resolvedTier = Tier.T0Master;
      accepted = true;
    }

    // 3. Build the escalation order: pinned primary (LakeB2B) then the
    //    configurable priority list for the still-missing required fields.
    if (!accepted) {
      const missing0 = required.filter((f) => !hasField(contact, f));
      const pinned = PINNED_PRIMARY.map((n) => this.registry.get(n)).filter(
        (a): a is ProviderAdapter => a !== undefined,
      );
      const escalation = [...pinned, ...this.registry.orderedFor(missing0)];

      for (const adapter of escalation) {
        if (accepted) break;
        const outcome = await this.tryAdapter(contact, adapter, ctx, () =>
          round6(totalCost),
        );
        if (outcome === "skip") continue;
        totalCost = outcome.totalCost;
        if (outcome.accepted) {
          resolvedTier = adapter.tier;
          accepted = true;
          break;
        }
      }
    }

    const status = accepted ? JobStatus.Accepted : JobStatus.Exhausted;
    contact.status = status;
    const attempts = [...attemptsByTier.values()].sort(
      (a, b) => tierOrder(a.tier) - tierOrder(b.tier),
    );
    return {
      contactId: contact.contactId,
      externalRef: contact.externalRef,
      status,
      requiredFields: required,
      resolvedTier,
      tiersAttempted: attempts,
      fields: contact.fields,
      firmographics: contact.firmographics,
      completenessScore: contact.completenessScore,
      confidenceScore: contact.confidenceScore,
      totalCostUsd: round6(totalCost),
      masterWriteback: false,
      notes,
    };
  }

  // --- internals ----------------------------------------------------------

  private async tryAdapter(
    contact: Contact,
    adapter: ProviderAdapter,
    ctx: {
      attemptsByTier: Map<Tier, TierAttempt>;
      tierSpend: Map<Tier, number>;
      notes: string[];
      called: Set<string>;
      jobBudget: number;
      maxTier: Tier;
      jobId: string | null;
      required: string[];
    },
    spentSoFar: () => number,
  ): Promise<"skip" | { totalCost: number; accepted: boolean }> {
    const { notes, called, required } = ctx;
    if (called.has(adapter.name)) return "skip";
    if (tierOrder(adapter.tier) > tierOrder(ctx.maxTier)) return "skip";
    if (!adapter.canSupply(required.filter((f) => !hasField(contact, f)))) {
      return "skip";
    }
    if (!(await adapter.isEnabled(this.settings, this.clerkUserId))) {
      return "skip";
    }
    const breaker = this.registry.breaker(adapter.name);
    if (!breaker.allow()) {
      notes.push(`Circuit open for ${adapter.name}; skipped.`);
      return "skip";
    }

    let totalCost = spentSoFar();
    const tierSpent = ctx.tierSpend.get(adapter.tier) ?? 0;
    if (
      adapter.costPerCall > 0 &&
      totalCost + adapter.costPerCall > ctx.jobBudget
    ) {
      notes.push(`Skipped ${adapter.name}: would exceed job budget.`);
      return "skip";
    }
    if (
      adapter.costPerCall > 0 &&
      tierSpent + adapter.costPerCall > this.settings.perTierBudgetUsd
    ) {
      notes.push(`Skipped ${adapter.name}: would exceed per-tier budget.`);
      return "skip";
    }

    const result = await this.callWithCache(
      adapter,
      contact,
      adapter.tier,
      ctx.jobId,
    );
    called.add(adapter.name);
    if (result.success) breaker.recordSuccess();
    else breaker.recordFailure();

    totalCost += result.costUsd;
    ctx.tierSpend.set(adapter.tier, tierSpent + result.costUsd);
    if (Object.keys(result.fields).length > 0) {
      await this.mergeAndGate(contact, result.fields, notes);
    }
    for (const [k, v] of Object.entries(result.firmographics)) {
      if (v !== null && v !== undefined && v !== "") {
        contact.firmographics[k] = v;
      }
    }
    this.recompute(contact, required);

    const accepted = this.isAcceptable(contact, required, adapter.tier);

    const attempt = ctx.attemptsByTier.get(adapter.tier) ?? {
      tier: adapter.tier,
      providersCalled: [],
      accepted: false,
      costUsd: 0,
      confidenceAfter: 0,
    };
    attempt.providersCalled.push(adapter.name);
    attempt.costUsd = round6(attempt.costUsd + result.costUsd);
    attempt.confidenceAfter = contact.confidenceScore;
    attempt.accepted = attempt.accepted || accepted;
    ctx.attemptsByTier.set(adapter.tier, attempt);

    return { totalCost, accepted };
  }

  /** Check the cache, else call the adapter, then cache + audit the result. */
  private async callWithCache(
    adapter: ProviderAdapter,
    contact: Contact,
    tier: Tier,
    jobId: string | null,
  ): Promise<ProviderResult> {
    const idHash = identityHash(contact);
    const cached = await this.cacheGet(idHash, adapter.name);
    if (cached !== null) {
      cached.costUsd = 0; // reuse costs nothing
      await this.logCall(cached, contact, tier, jobId, true);
      return cached;
    }
    const started = Date.now();
    const result = await safeFetch(
      adapter,
      contact,
      this.settings,
      this.clerkUserId,
    );
    if (result.latencyMs === null) {
      result.latencyMs = Date.now() - started;
    }
    await this.cacheSet(idHash, result, this.settings);
    await this.logCall(result, contact, tier, jobId, false);
    return result;
  }

  private async mergeAndGate(
    contact: Contact,
    incoming: Record<string, FieldValue>,
    notes: string[],
  ): Promise<void> {
    contact.fields = mergeFields(contact.fields, incoming);
    if ("email" in incoming) {
      await this.gateExistingEmail(contact, notes);
    }
  }

  private async gateExistingEmail(
    contact: Contact,
    notes: string[],
  ): Promise<void> {
    const fv = contact.fields.email;
    if (
      fv === undefined ||
      fv.value === null ||
      fv.value === undefined ||
      fv.value === ""
    ) {
      return;
    }
    const verification = await this.verify(String(fv.value), this.settings);
    if (verification === null) return;
    const gated = applyEmailGate(fv, verification.verdict, this.settings);
    if (gated === null) {
      delete contact.fields.email;
      notes.push(
        `Email ${String(fv.value)} undeliverable (${verification.provider}); discarded.`,
      );
    } else {
      contact.fields.email = gated;
    }
  }

  private recompute(contact: Contact, required: string[]): void {
    contact.completenessScore = completeness(contact.fields, required);
    contact.confidenceScore = recordConfidence(contact.fields, required);
  }

  private isAcceptable(
    contact: Contact,
    required: string[],
    tier: Tier,
  ): boolean {
    const allPresent = required.every((f) => hasField(contact, f));
    if (!allPresent) return false;
    return contact.confidenceScore >= acceptThreshold(tier, this.settings);
  }

  private async logCall(
    result: ProviderResult,
    contact: Contact,
    tier: Tier,
    jobId: string | null,
    cacheHit: boolean,
  ): Promise<void> {
    const confidences = Object.values(result.fields).map((fv) => fv.confidence);
    const row: Record<string, unknown> = {
      jobId,
      contactId: contact.contactId,
      tier,
      provider: result.provider,
      requestIdentifiers:
        Object.keys(result.requestIdentifiers).length > 0
          ? result.requestIdentifiers
          : { ...minimalIdentifiers(contact) },
      success: result.success,
      fieldsReturned: Object.keys(result.fields).sort(),
      confidence: confidences.length ? Math.max(...confidences) : 0,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      httpStatus: result.httpStatus,
      cacheHit,
      error: result.error,
      clerkUserId: this.clerkUserId ?? null,
    };
    await this.audit(row);
  }
}
