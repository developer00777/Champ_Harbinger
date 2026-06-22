/**
 * Named model presets to avoid scattering OpenRouter model IDs throughout
 * the codebase. Override per-call only when a feature needs something
 * specific (cheap classifier vs. heavy drafting model).
 */
export const Models = {
  default: () =>
    process.env.HARBINGER_DEFAULT_MODEL || "anthropic/claude-sonnet-4.6",
  drafting: "anthropic/claude-sonnet-4.6",
  // Personalization (cold-email composition). A/B-validated at parity with
  // claude-sonnet-4 at a fraction of the cost — see scripts/ab-personalization.mts.
  // Env-overridable (HARBINGER_PERSONALIZATION_MODEL) to swap without a deploy.
  personalization: () =>
    process.env.HARBINGER_PERSONALIZATION_MODEL ||
    "deepseek/deepseek-v4-flash",
  // claude-haiku-4.5 is cheap, fast, and v3-spec compliant via OpenRouter.
  // openai/gpt-4o-mini returned a v1 spec response that AI SDK 6 rejects
  // for generateObject calls.
  classification: "anthropic/claude-haiku-4.5",
  cheap: "anthropic/claude-haiku-4.5",
  reasoning: "openai/o1-mini",
} as const;

export type ModelKey = keyof typeof Models;
