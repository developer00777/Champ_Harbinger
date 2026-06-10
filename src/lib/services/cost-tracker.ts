import { AsyncLocalStorage } from "node:async_hooks";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

// ── Pricing constants (USD) ──────────────────────────────────────────────
// Last verified 2026-03-29. Sources:
//   Claude  -- https://docs.anthropic.com/en/docs/about-claude/pricing
//   Apify   -- https://apify.com/pricing (pay-per-result actors)
//   BB      -- https://browserbase.com/pricing
export const PRICING = {
  // Claude Sonnet 4 (per million tokens)
  claude_sonnet_input: 3.0,
  claude_sonnet_output: 15.0,
  claude_sonnet_cache_read: 0.3,
  claude_sonnet_cache_write: 3.75,
  // Claude Haiku 4.5 (per million tokens)
  claude_haiku_input: 1.0,
  claude_haiku_output: 5.0,
  claude_haiku_cache_read: 0.1,
  claude_haiku_cache_write: 1.25,
  exa_search: 0,
  // Apify -- pay-per-result pricing (~20 posts per profile scrape)
  apify_linkedin: 0.05,
  // Apify tweet scraper -- $0.40/1k tweets, ~$0.04 for 100 tweets
  apify_twitter: 0.04,
  // Browserbase Fetch API with proxies -- $4 per 1,000 requests
  browserbase_fetch: 0.004,
  // Browserbase browser session -- billed by time, $0.10/hr
  browserbase_session_per_hr: 0.1,
  // Google Places API (New) -- Text Search with reviews field mask
  google_places_search: 0.032,
  // ChampMail / email provider -- usage-based pricing, ~$0.40 per 1,000 emails
  champmail_email: 0.0004,
} as const;

// ── Action context (AsyncLocalStorage) ───────────────────────────────────
// Route handlers wrap their work in `withAction()`. Every `trackUsage` call
// inside automatically inherits the action_id + label -- no signature changes
// needed on any service.

interface ActionContext {
  action_id: string;
  action_label: string;
}

const actionStore = new AsyncLocalStorage<ActionContext>();

/**
 * Run `fn` inside an action context. All `trackUsage` calls made during `fn`
 * (including from nested service calls) will be tagged with this action.
 *
 * Usage:
 *   return withAction("Enrich person: John Smith", async () => { ... });
 */
export function withAction<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return actionStore.run(
    { action_id: crypto.randomUUID(), action_label: label },
    fn,
  );
}

export type ServiceName =
  | "claude"
  | "exa"
  | "apify"
  | "browserbase"
  | "google"
  | "agentmail" // retained for legacy DB rows
  | "champmail";

interface UsageEntry {
  service: ServiceName;
  operation: string;
  tokens_input?: number;
  tokens_output?: number;
  estimated_cost_usd: number;
  /**
   * Real billed cost in USD reported by the provider (e.g. OpenRouter usage
   * accounting). When present it overrides `estimated_cost_usd` for the stored
   * row and tags the row as `costSource: "openrouter"`.
   */
  real_cost_usd?: number;
  /** Provider generation id (OpenRouter), stored in metadata for reconciliation. */
  generation_id?: string;
  metadata?: Record<string, unknown>;
  campaign_id?: string;
  user_id?: string;
}

export type ClaudeModel = "sonnet" | "haiku";

export interface ClaudeCostParams {
  model: ClaudeModel;
  /** Total input tokens (AI SDK's `usage.inputTokens`, already includes cache reads + writes). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from the prompt cache, billed at 10% of uncached input. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache, billed at 125% of uncached input. */
  cacheCreationTokens?: number;
}

/**
 * Estimate Claude API cost from token counts with cache-aware pricing.
 * `inputTokens` is the total (cache reads + cache writes + uncached); we subtract
 * the cache buckets to get the uncached remainder, then bill each at its own rate.
 */
export function estimateClaudeCost(params: ClaudeCostParams): number {
  const { model } = params;
  const uncachedRate =
    model === "sonnet"
      ? PRICING.claude_sonnet_input
      : PRICING.claude_haiku_input;
  const cacheReadRate =
    model === "sonnet"
      ? PRICING.claude_sonnet_cache_read
      : PRICING.claude_haiku_cache_read;
  const cacheWriteRate =
    model === "sonnet"
      ? PRICING.claude_sonnet_cache_write
      : PRICING.claude_haiku_cache_write;
  const outputRate =
    model === "sonnet"
      ? PRICING.claude_sonnet_output
      : PRICING.claude_haiku_output;

  const cacheRead = params.cacheReadTokens ?? 0;
  const cacheWrite = params.cacheCreationTokens ?? 0;
  const uncached = Math.max(0, params.inputTokens - cacheRead - cacheWrite);

  return (
    (uncached / 1_000_000) * uncachedRate +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (params.outputTokens / 1_000_000) * outputRate
  );
}

interface AiSdkUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  cachedInputTokens?: number;
}

/**
 * Convenience wrapper: pulls cache breakdown from AI SDK's `usage` object so
 * call sites don't have to reach into `providerMetadata.anthropic` manually.
 */
export function estimateClaudeCostFromUsage(
  model: ClaudeModel,
  usage: AiSdkUsageLike,
): number {
  return estimateClaudeCost({
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens:
      usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
    cacheCreationTokens: usage.inputTokenDetails?.cacheWriteTokens,
  });
}

/**
 * Log an API usage entry. Fire-and-forget -- errors are swallowed so callers
 * are never disrupted by tracking failures.
 *
 * Automatically picks up action_id/action_label from the nearest `withAction`
 * context if one exists.
 */
export function trackUsage(entry: UsageEntry): void {
  const ctx = actionStore.getStore();

  const hasRealCost = typeof entry.real_cost_usd === "number";
  const costUsd = hasRealCost
    ? (entry.real_cost_usd as number)
    : entry.estimated_cost_usd;
  const metadata: Record<string, unknown> = {
    ...(entry.metadata ?? {}),
    costSource: hasRealCost ? "openrouter" : "estimate",
    ...(entry.generation_id
      ? { openrouterGenerationId: entry.generation_id }
      : {}),
  };

  void (async () => {
    try {
      await adminDb.insert(schema.apiUsage).values({
        service: entry.service,
        operation: entry.operation,
        tokensInput: entry.tokens_input ?? null,
        tokensOutput: entry.tokens_output ?? null,
        estimatedCostUsd: String(costUsd),
        metadata,
        campaignId: entry.campaign_id ?? null,
        clerkUserId: entry.user_id ?? "system",
        clerkOrgId: null,
        actionId: ctx?.action_id
          ? (ctx.action_id as unknown as undefined)
          : undefined,
        actionLabel: ctx?.action_label ?? null,
      });
    } catch (err) {
      console.error("[cost-tracker] unexpected error:", err);
    }
  })();
}
