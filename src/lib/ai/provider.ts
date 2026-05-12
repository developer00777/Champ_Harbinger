import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { aiEnv } from "./env";
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
