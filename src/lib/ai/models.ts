/**
 * Every LLM call in the app routes through ONE model, chosen by a single env
 * var. No model id is hard-coded anywhere except the last-resort default below,
 * so switching the whole app to a different model is a one-line config change —
 * no code edit, no redeploy of code.
 *
 *   HARBINGER_MODEL=deepseek/deepseek-v4-flash   ← the one knob
 *
 * DeepSeek V4 Flash is the chosen model: cheap/fast, v3-spec compliant for
 * generateObject, and A/B-validated at parity with Claude Sonnet 4 for
 * personalization (scripts/ab-personalization.mts).
 */
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

function model(): string {
  return process.env.HARBINGER_MODEL || DEFAULT_MODEL;
}

// All tiers reference the same env-driven model. The presets remain so call
// sites can stay semantic (Models.classification, Models.drafting, …) and a
// future need to split a tier onto its own model is a one-line change here.
export const Models = {
  default: model,
  drafting: model(),
  personalization: model,
  classification: model(),
  cheap: model(),
  reasoning: model(),
} as const;

export type ModelKey = keyof typeof Models;
