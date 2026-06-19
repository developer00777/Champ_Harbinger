/** Money as a clean $X.XX string. */
export function fmtUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** A nullable limit: "Unlimited" when null, otherwise $X.XX. */
export function fmtLimit(usd: number | null): string {
  return usd == null ? "Unlimited" : fmtUsd(usd);
}

/**
 * Spend as a fraction of a limit, clamped 0..1, or null if no limit.
 * Used to colour the spend cell.
 */
export function spendRatio(spend: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.min(1, spend / limit);
}

export function spendToneClass(ratio: number | null): string {
  if (ratio == null) return "";
  if (ratio >= 1) return "text-destructive";
  if (ratio >= 0.8) return "text-amber-600 dark:text-amber-400";
  return "";
}
