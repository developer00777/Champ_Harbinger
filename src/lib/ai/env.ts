import { z } from "zod";

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  HARBINGER_DEFAULT_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-sonnet-4.6"),
  // Max concurrent OpenRouter calls in this process — protects the shared key
  // from 429s when many users run LLM-heavy work at once.
  LLM_MAX_CONCURRENCY: z.coerce.number().int().positive().default(12),
});

type AiEnv = z.infer<typeof schema>;

let cached: AiEnv | undefined;

function loadAiEnv(): AiEnv {
  if (!cached) {
    cached = schema.parse({
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      HARBINGER_DEFAULT_MODEL: process.env.HARBINGER_DEFAULT_MODEL,
      LLM_MAX_CONCURRENCY: process.env.LLM_MAX_CONCURRENCY,
    });
  }
  return cached;
}

// Lazy: validated on first property access, not on import. Modules that
// import something from ./provider (e.g. a deterministic keyword pre-filter
// that never actually calls the LLM) must not crash just for having this in
// their import graph — the throw still happens, just deferred to the first
// real read of a field, exactly where an actual attempt to use OpenRouter
// would need it anyway.
export const aiEnv: AiEnv = new Proxy({} as AiEnv, {
  get(_target, prop, receiver) {
    return Reflect.get(loadAiEnv(), prop, receiver);
  },
});
