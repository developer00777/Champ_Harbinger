import "server-only";

import { generateObject, generateText } from "ai";

import { runLlm } from "./concurrency";

/**
 * Concurrency-limited drop-in replacements for the `ai` SDK's `generateObject`
 * and `generateText`. Every LLM call routes through the global semaphore
 * (LLM_MAX_CONCURRENCY) so the shared OpenRouter key is never hammered into
 * 429s. Import these instead of the raw `ai` functions (enforced by ESLint).
 *
 * The wrapper preserves the full overloaded signature of the wrapped function.
 */
function limit<F extends (arg: never) => Promise<unknown>>(fn: F): F {
  return ((arg: never) => runLlm(() => fn(arg))) as F;
}

export const generateObjectLimited = limit(
  generateObject as (arg: never) => Promise<unknown>,
) as typeof generateObject;

export const generateTextLimited = limit(
  generateText as (arg: never) => Promise<unknown>,
) as typeof generateText;
