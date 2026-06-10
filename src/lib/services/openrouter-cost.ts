/**
 * Extract the real per-generation cost + generation id that OpenRouter returns
 * when usage accounting is enabled (`openrouter(model, { usage: { include: true } })`).
 *
 * The OpenRouter AI SDK provider surfaces the billed cost under
 * `providerMetadata.openrouter.usage.cost` (USD) and the generation id as the
 * response id. The exact shape is not strongly typed by the provider, so we read
 * defensively from several plausible locations and return `undefined` fields when
 * absent — callers fall back to a local token estimate in that case.
 */

interface AiResultLike {
  providerMetadata?: Record<string, unknown> | undefined;
  response?: { id?: string } | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export interface GenerationCost {
  generationId?: string;
  /** Real billed cost in USD (includes any OpenRouter markup), if reported. */
  realCostUsd?: number;
}

export function extractGenerationCost(result: AiResultLike): GenerationCost {
  const openrouter = asRecord(result.providerMetadata?.["openrouter"]);
  const usage = asRecord(openrouter?.["usage"]);

  const realCostUsd =
    asNumber(usage?.["cost"]) ??
    asNumber(usage?.["totalCost"]) ??
    asNumber(openrouter?.["cost"]) ??
    asNumber(openrouter?.["totalCost"]);

  const generationId =
    (typeof openrouter?.["generationId"] === "string"
      ? (openrouter["generationId"] as string)
      : undefined) ??
    (typeof result.response?.id === "string" ? result.response.id : undefined);

  return { generationId, realCostUsd };
}
