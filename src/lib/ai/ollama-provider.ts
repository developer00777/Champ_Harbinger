import "server-only";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

/**
 * Self-hosted Ollama is an optional drop-in for high-volume classification
 * tasks (criteria translation, signal verification). When `OLLAMA_BASE_URL`
 * is set, classification routes through a local model — slashing per-call
 * cost vs OpenRouter. When unset, callers fall back to the OpenRouter
 * classification model in `Models.classification`.
 *
 * Defaults:
 *   - OLLAMA_BASE_URL: unset (disabled by default)
 *   - OLLAMA_CLASSIFICATION_MODEL: llama3.1:8b
 */

const DEFAULT_MODEL = "llama3.1:8b";

function getBaseUrl(): string | null {
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getModelId(): string {
  return process.env.OLLAMA_CLASSIFICATION_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * True when `OLLAMA_BASE_URL` is set to a non-empty value.
 */
export function isOllamaConfigured(): boolean {
  return getBaseUrl() !== null;
}

/**
 * Returns the Ollama classification model when configured, otherwise null.
 * The Ollama HTTP API path is appended automatically — the value of
 * OLLAMA_BASE_URL should point at the root (e.g. http://localhost:11434).
 */
export function getOllamaClassificationModel(): LanguageModel | null {
  const baseURL = getBaseUrl();
  if (!baseURL) return null;

  const ollama = createOllama({
    // The provider expects the OpenAI-style /v1 endpoint suffix.
    baseURL: `${baseURL}/api`,
  });

  return ollama(getModelId()) as unknown as LanguageModel;
}
