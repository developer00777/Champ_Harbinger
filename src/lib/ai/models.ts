/**
 * Named model presets to avoid scattering OpenRouter model IDs throughout
 * the codebase. Override per-call only when a feature needs something
 * specific (cheap classifier vs. heavy drafting model).
 */
export const Models = {
  default: () => process.env.HARBINGER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4.6',
  drafting: 'anthropic/claude-sonnet-4.6',
  classification: 'openai/gpt-4o-mini',
  cheap: 'openai/gpt-4o-mini',
  reasoning: 'openai/o1-mini',
} as const;

export type ModelKey = keyof typeof Models;
