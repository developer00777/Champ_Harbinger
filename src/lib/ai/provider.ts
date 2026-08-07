import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { aiEnv } from "./env";
import { Models, resolveModelForUser } from "./models";
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
  return openrouter(modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL, {
    // Return real billed cost in providerMetadata.openrouter.usage so spend
    // tracking mirrors OpenRouter instead of relying on local token estimates.
    usage: { include: true },
  }) as unknown as LanguageModel;
}

/**
 * Like getModel(), but resolves WHICH model via the three-layer default chain
 * (user preference → admin app-setting → env) instead of a hard-coded id.
 * Prefer this at entry points where a clerkUserId is naturally available.
 * An explicit `modelId` (a call site that deliberately picked a tier) wins.
 */
export async function getModelForUser(
  clerkUserId?: string,
  modelId?: string,
): Promise<LanguageModel> {
  const resolved = modelId ?? (await resolveModelForUser(clerkUserId));
  return getModel(resolved, clerkUserId);
}

/**
 * Synchronous fallback for contexts where async is not possible.
 * Always uses the server-level env var — no per-user key lookup.
 */
export function getModelSync(modelId?: string): LanguageModel {
  const openrouter = createOpenRouter({ apiKey: aiEnv.OPENROUTER_API_KEY });
  return openrouter(modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL, {
    usage: { include: true },
  }) as unknown as LanguageModel;
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

/**
 * BYOK-aware classification model. Prefer this over
 * `getClassificationModelSync()` anywhere a clerkUserId is available.
 *
 * Why it exists: `getModelSync()` (and therefore
 * `getClassificationModelSync()`) can never consult `user_api_keys`, because
 * that lookup is async. Any call site using the sync variants silently ignores
 * a key the user saved under Settings → Keys and falls back to the server env
 * var. That produced a confusing failure — the user pastes a working
 * OpenRouter key, the Agent chat starts working (it resolves per-user), and
 * discovery keeps reporting "OpenRouter rejected the API key" because it went
 * down the sync path to a stale server key.
 *
 * Ollama still wins when configured: it is local and needs no key at all, so
 * there is nothing to resolve per user.
 */
export async function getClassificationModel(
  clerkUserId?: string,
): Promise<LanguageModel> {
  if (isOllamaConfigured()) {
    const ollamaModel = getOllamaClassificationModel();
    if (ollamaModel) return ollamaModel;
  }
  return getModel(Models.classification, clerkUserId);
}
