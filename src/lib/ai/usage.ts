import { aiCallsTotal, aiCallDuration } from "@/lib/monitoring/metrics";
import { extractGenerationCost } from "@/lib/services/openrouter-cost";
import {
  trackUsage,
  estimateClaudeCostFromUsage,
  type ClaudeModel,
  type ServiceName,
} from "@/lib/services/cost-tracker";

/**
 * Minimal shape shared by `generateObject` / `generateText` / `streamText`
 * results — enough to read token usage, provider cost metadata, and the model id.
 */
interface AiResultLike {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    cachedInputTokens?: number;
  };
  providerMetadata?: Record<string, unknown>;
  response?: { id?: string; modelId?: string };
}

export interface RecordAiUsageOpts {
  /** Operation label stored on the api_usage row (e.g. "evaluate-intent"). */
  operation: string;
  /** Pricing bucket for the local estimate fallback. Default "sonnet". */
  costModel?: ClaudeModel;
  /** Prometheus `model` label. Defaults to the response model id or "unknown". */
  modelLabel?: string;
  /** `Date.now()` captured before the call — enables the duration histogram. */
  startedAt?: number;
  status?: "ok" | "error";
  service?: ServiceName;
  metadata?: Record<string, unknown>;
  campaignId?: string;
  userId?: string;
}

/**
 * Record one AI call: increments Prometheus metrics and writes an api_usage row,
 * preferring OpenRouter's real billed cost (usage accounting) and falling back to
 * a local token estimate. Call this immediately after a `generateObject` /
 * `generateText` resolves, passing the FULL result (not just `{ object, usage }`)
 * so provider cost metadata is available.
 */
export function recordAiUsage(
  result: AiResultLike,
  opts: RecordAiUsageOpts,
): void {
  const { generationId, realCostUsd } = extractGenerationCost(result);
  const usage = result.usage ?? {};
  const modelLabel = opts.modelLabel ?? result.response?.modelId ?? "unknown";

  try {
    aiCallsTotal.labels(modelLabel, opts.status ?? "ok").inc();
    if (opts.startedAt != null) {
      aiCallDuration
        .labels(modelLabel)
        .observe((Date.now() - opts.startedAt) / 1000);
    }
  } catch {
    // never let metrics recording disrupt the caller
  }

  trackUsage({
    service: opts.service ?? "claude",
    operation: opts.operation,
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd:
      realCostUsd ??
      estimateClaudeCostFromUsage(opts.costModel ?? "sonnet", usage),
    real_cost_usd: realCostUsd,
    generation_id: generationId,
    metadata: opts.metadata,
    campaign_id: opts.campaignId,
    user_id: opts.userId,
  });
}

/** Record a failed AI call (no usage row, just the error counter). */
export function recordAiError(modelLabel: string, startedAt?: number): void {
  try {
    aiCallsTotal.labels(modelLabel, "error").inc();
    if (startedAt != null) {
      aiCallDuration
        .labels(modelLabel)
        .observe((Date.now() - startedAt) / 1000);
    }
  } catch {
    // ignore
  }
}
