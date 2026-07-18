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

/**
 * Curated OpenRouter models users may pick from in Settings. The env default
 * always appears (first) even if it drifts from this list.
 */
export const CURATED_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash (fast, cheap)",
  },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
  { id: "google/gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
];

/**
 * Async model resolution — the "one knob" extended to three layers, first
 * match wins:
 *
 *   1. userSettings.preferred_model  (per-user pick in Settings)
 *   2. appSettings "default_model"   (super-admin console)
 *   3. env HARBINGER_MODEL / DEFAULT_MODEL (existing sync default)
 *
 * Sync callers (Models.*) keep working unchanged on layer 3. Use this where a
 * clerkUserId is naturally in hand (chat routes, user-triggered jobs); DB
 * modules are imported dynamically so this file stays client-safe/pure.
 * Resolution failures fall back to the env default — model choice must never
 * take a request down.
 */
export async function resolveModelForUser(
  clerkUserId?: string,
): Promise<string> {
  try {
    if (clerkUserId) {
      const [{ adminDb }, { schema }, { eq }] = await Promise.all([
        import("@/lib/db/admin"),
        import("@/db"),
        import("drizzle-orm"),
      ]);
      const [row] = await adminDb
        .select({ preferredModel: schema.userSettings.preferredModel })
        .from(schema.userSettings)
        .where(eq(schema.userSettings.clerkUserId, clerkUserId))
        .limit(1);
      const preferred = row?.preferredModel?.trim();
      if (preferred) return preferred;
    }
    const { getAppSettingString } = await import("@/lib/app-settings");
    const adminDefault = await getAppSettingString("default_model");
    if (adminDefault) return adminDefault;
  } catch (err) {
    console.error(
      "[models] resolveModelForUser failed (using env default):",
      err,
    );
  }
  return model();
}
