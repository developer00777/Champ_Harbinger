import { BudgetExceededError } from "./guard";

/**
 * Maps a BudgetExceededError to a 402 Payment Required JSON response (distinct
 * from a 429 OpenRouter rate-limit). Returns null for any other error so the
 * caller can rethrow.
 */
export function budgetErrorResponse(
  err: unknown,
  extra: Record<string, unknown> = {},
): Response | null {
  if (err instanceof BudgetExceededError) {
    return Response.json(
      {
        error: err.message,
        scope: err.scope,
        reason: err.reason,
        limitUsd: err.limitUsd,
        spentUsd: err.spentUsd,
        resetsAt: err.resetsAt.toISOString(),
        ...extra,
      },
      { status: 402 },
    );
  }
  return null;
}
