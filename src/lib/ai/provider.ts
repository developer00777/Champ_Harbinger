import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { aiEnv } from "./env";

const openrouter = createOpenRouter({
  apiKey: aiEnv.OPENROUTER_API_KEY,
});

/**
 * Returns a Vercel AI SDK LanguageModel. Pass an OpenRouter model ID
 * (e.g. "anthropic/claude-sonnet-4.6", "openai/gpt-4o-mini") or use the
 * Models map.
 */
export function getModel(modelId?: string): LanguageModel {
  return openrouter(
    modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL,
  ) as unknown as LanguageModel;
}

export { openrouter };
