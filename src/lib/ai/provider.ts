import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { aiEnv } from "./env";
import { Models } from "./models";
import {
  getOllamaClassificationModel,
  isOllamaConfigured,
} from "./ollama-provider";
import { getUserApiKey } from "@/lib/db/user-keys";

/**
 * Returns a LanguageModel using the user's stored OpenRouter key if available,
 * falling back to the server-level OPENROUTER_API_KEY env var.
 *
 * When clerkUserId is provided, the DB is queried for a per-user key first.
 * Without it (e.g. background jobs), only the env var is used.
 */
export async function getModel(
  modelId?: string,
  clerkUserId?: string,
): Promise<LanguageModel> {
  const apiKey = clerkUserId
    ? await getUserApiKey(
        "openrouter_api_key",
        clerkUserId,
        aiEnv.OPENROUTER_API_KEY,
      )
    : aiEnv.OPENROUTER_API_KEY;

  const openrouter = createOpenRouter({
    apiKey: apiKey ?? aiEnv.OPENROUTER_API_KEY,
  });
  return openrouter(
    modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL,
  ) as unknown as LanguageModel;
}

/**
 * Synchronous fallback for contexts where async is not possible.
 * Always uses the server-level env var — no per-user key lookup.
 */
export function getModelSync(modelId?: string): LanguageModel {
  const openrouter = createOpenRouter({ apiKey: aiEnv.OPENROUTER_API_KEY });
  return openrouter(
    modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL,
  ) as unknown as LanguageModel;
}

/**
 * Returns the model used for high-volume classification tasks (criteria
 * translation, verification, signal triage). When `OLLAMA_BASE_URL` is set,
 * routes through the self-hosted Ollama instance for free per-call inference.
 * Otherwise falls back to `Models.classification` via OpenRouter.
 *
 * Use this in place of `getModelSync(Models.classification)` for any
 * classification workload that should benefit from a local model when one
 * is available.
 */
export function getClassificationModelSync(): LanguageModel {
  if (isOllamaConfigured()) {
    const ollamaModel = getOllamaClassificationModel();
    if (ollamaModel) return ollamaModel;
  }
  return getModelSync(Models.classification);
}
