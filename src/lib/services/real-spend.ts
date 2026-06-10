/**
 * OpenRouter is the only LLM billing source. Per-generation cost is captured
 * inline at call time (see recordAiUsage / openrouter-cost) and stored on each
 * api_usage row, so windowed spend in the dashboard is already real — no admin
 * cost-report reconciliation needed.
 *
 * This module only exposes the account-level credit balance, shown as a
 * "remaining credits" gauge. Returns null on any failure so the UI degrades.
 */

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export interface OpenRouterCredits {
  /** Lifetime usage in USD reported by OpenRouter. */
  usage: number;
  /** Remaining credit balance in USD (purchased − used). */
  remaining: number;
}

export async function fetchOpenRouterCredits(): Promise<OpenRouterCredits | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  try {
    const res = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/credits",
      { headers: { Authorization: `Bearer ${key}` } },
      15_000,
    );
    if (!res.ok) {
      console.error(
        `[real-spend] openrouter ${res.status}:`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const totalCredits = Number(json.data?.total_credits ?? 0);
    const totalUsage = Number(json.data?.total_usage ?? 0);
    return { usage: totalUsage, remaining: totalCredits - totalUsage };
  } catch (err) {
    console.error("[real-spend] openrouter error:", err);
    return null;
  }
}
