import type { EnrichmentSettings } from "../config";
import {
  emptyResult,
  Tier,
  tierOrder,
  type Contact,
  type ProviderResult,
} from "../types";

/**
 * Provider adapter contract, circuit breaker, and registry.
 *
 * Every tier adapter implements ProviderAdapter:
 *   - tier            : which Tier it belongs to (coarse grouping for budgets)
 *   - name            : stable provider id; MUST match its providerPriority entry
 *   - costPerCall     : USD charged on a billable call
 *   - canSupply(req)  : whether it can plausibly fill any required field
 *   - isEnabled()     : whether it has the key/credentials it needs
 *   - fetch(contact)  : returns a ProviderResult and NEVER throws
 *
 * Adapters that need an API key no-op gracefully (return an empty
 * ProviderResult) when the key is missing, so the engine runs with only the
 * owned providers configured (the one-OpenRouter-key path).
 *
 * The orchestrator depends only on this interface, which keeps it network-free
 * and testable with in-memory fakes.
 */
export interface ProviderAdapter {
  readonly tier: Tier;
  readonly name: string;
  readonly costPerCall: number;

  /** Whether this adapter can plausibly fill at least one required field. */
  canSupply(requiredFields: string[]): boolean;

  /**
   * Whether the adapter has what it needs to run. Adapters that require a key
   * resolve it (per user then env) and return false when absent. clerkUserId is
   * optional so the engine can run without a Clerk session.
   */
  isEnabled(
    settings: EnrichmentSettings,
    clerkUserId?: string,
  ): boolean | Promise<boolean>;

  /**
   * Fetch enrichment for a single contact. MUST NOT throw. On any error
   * (missing key, timeout, bad status) return an empty/failed ProviderResult.
   * Only minimal identifiers may be sent to external providers.
   */
  fetch(
    contact: Contact,
    settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<ProviderResult>;
}

type BreakerState = "closed" | "open" | "half_open";

/**
 * Per-provider circuit breaker.
 *
 * closed  : calls allowed. After `threshold` consecutive failures -> open.
 * open    : calls blocked until `cooldownMs` elapses -> half_open.
 * halfOpen: one trial call allowed. Success -> closed, failure -> open.
 *
 * Time source is injectable for deterministic tests.
 */
export class CircuitBreaker {
  readonly threshold: number;
  readonly cooldownMs: number;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private internalState: BreakerState = "closed";

  constructor(
    threshold: number,
    cooldownMs: number,
    now: () => number = Date.now,
  ) {
    this.threshold = Math.max(1, Math.trunc(threshold));
    this.cooldownMs = Math.max(0, cooldownMs);
    this.now = now;
  }

  get state(): BreakerState {
    if (this.internalState === "open" && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.internalState = "half_open";
      }
    }
    return this.internalState;
  }

  /** True when a call may proceed (closed or half_open trial). */
  allow(): boolean {
    const s = this.state;
    return s === "closed" || s === "half_open";
  }

  /** Reset on any success: close the breaker, clear the failure count. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.internalState = "closed";
  }

  /** Count a failure; open the breaker once the threshold is reached. */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.internalState = "open";
      this.openedAt = this.now();
    }
  }

  snapshot(): {
    state: BreakerState;
    consecutiveFailures: number;
    threshold: number;
    cooldownMs: number;
  } {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.threshold,
      cooldownMs: this.cooldownMs,
    };
  }
}

/**
 * Run adapter.fetch with a final guard so nothing ever escapes as an exception.
 * Adapters should already be defensive; this is belt-and-braces.
 */
export async function safeFetch(
  adapter: ProviderAdapter,
  contact: Contact,
  settings: EnrichmentSettings,
  clerkUserId?: string,
): Promise<ProviderResult> {
  try {
    return await adapter.fetch(contact, settings, clerkUserId);
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    return emptyResult(
      adapter.name,
      adapter.tier,
      `unexpected: ${name}: ${msg}`,
    );
  }
}

/** Does the provider cover at least one of the still-missing fields? */
function intersects(covers: string[], missing: string[]): boolean {
  const set = new Set(covers);
  for (const m of missing) if (set.has(m)) return true;
  return false;
}

/**
 * Holds adapters by name (and grouped by tier) plus a breaker per provider.
 * Injected into the orchestrator. Tests build a registry of fakes; production
 * calls registerDefaultProviders().
 */
export class ProviderRegistry {
  private readonly settings: EnrichmentSettings;
  private readonly byName = new Map<string, ProviderAdapter>();
  private readonly byTier = new Map<Tier, ProviderAdapter[]>();
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(settings: EnrichmentSettings) {
    this.settings = settings;
  }

  register(adapter: ProviderAdapter): void {
    this.byName.set(adapter.name, adapter);
    const list = this.byTier.get(adapter.tier) ?? [];
    list.push(adapter);
    this.byTier.set(adapter.tier, list);
    if (!this.breakers.has(adapter.name)) {
      this.breakers.set(
        adapter.name,
        new CircuitBreaker(
          this.settings.circuitBreakerThreshold,
          this.settings.circuitBreakerCooldownMs,
        ),
      );
    }
  }

  get(name: string): ProviderAdapter | undefined {
    return this.byName.get(name);
  }

  adaptersForTier(tier: Tier): ProviderAdapter[] {
    return [...(this.byTier.get(tier) ?? [])];
  }

  /**
   * The escalation order for a set of still-missing fields, driven by the
   * configurable provider priority list (price x coverage). Returns registered,
   * enabled adapters whose declared coverage (priority entry `covers`, falling
   * back to the adapter's own canSupply) intersects `missing`, in ascending
   * rank order. LakeB2B is intentionally excluded here: the orchestrator pins it
   * as the primary source ahead of this list.
   */
  orderedFor(missing: string[]): ProviderAdapter[] {
    const out: ProviderAdapter[] = [];
    for (const entry of this.settings.providerPriority) {
      if (!entry.enabled) continue;
      if (entry.name === "lakeb2b") continue;
      const adapter = this.byName.get(entry.name);
      if (!adapter) continue;
      const covered =
        entry.covers.length > 0
          ? intersects(entry.covers, missing)
          : adapter.canSupply(missing);
      if (covered) out.push(adapter);
    }
    return out;
  }

  breaker(providerName: string): CircuitBreaker {
    let b = this.breakers.get(providerName);
    if (!b) {
      b = new CircuitBreaker(
        this.settings.circuitBreakerThreshold,
        this.settings.circuitBreakerCooldownMs,
      );
      this.breakers.set(providerName, b);
    }
    return b;
  }

  allAdapters(): ProviderAdapter[] {
    const tiers = [...this.byTier.keys()].sort(
      (a, b) => tierOrder(a) - tierOrder(b),
    );
    const out: ProviderAdapter[] = [];
    for (const t of tiers) out.push(...(this.byTier.get(t) ?? []));
    return out;
  }

  /** Structured description for a list_providers tool / route. */
  async describe(clerkUserId?: string): Promise<
    Array<{
      tier: string;
      provider: string;
      costPerCallUsd: number;
      enabled: boolean;
      circuitBreaker: ReturnType<CircuitBreaker["snapshot"]>;
    }>
  > {
    const rows = [];
    for (const adapter of this.allAdapters()) {
      rows.push({
        tier: adapter.tier,
        provider: adapter.name,
        costPerCallUsd: adapter.costPerCall,
        enabled: await adapter.isEnabled(this.settings, clerkUserId),
        circuitBreaker: this.breaker(adapter.name).snapshot(),
      });
    }
    return rows;
  }
}
