import type { AdminOverview } from "@/lib/admin/overview";
import { fmtUsd, spendRatio, spendToneClass } from "@/components/admin/format";

function resetLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function GlobalHeader({ global }: { global: AdminOverview["global"] }) {
  const ratio = spendRatio(global.weekSpendUsd, global.limitUsd);
  const tone = spendToneClass(ratio);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="border-border rounded-lg border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-semibold tabular-nums ${tone}`}>
            {fmtUsd(global.weekSpendUsd)}
          </span>
          <span className="text-muted-foreground text-sm">spent this week</span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
          {global.limitUsd != null
            ? `of ${fmtUsd(global.limitUsd)} global budget`
            : "no global cap set"}
          {" · resets "}
          {resetLabel(global.weekResetIso)}
        </p>
        {ratio != null && (
          <div className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full ${
                ratio >= 1
                  ? "bg-destructive"
                  : ratio >= 0.8
                    ? "bg-amber-500"
                    : "bg-primary"
              }`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="border-border rounded-lg border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {global.openrouterCreditUsd != null
              ? fmtUsd(global.openrouterCreditUsd)
              : "—"}
          </span>
          <span className="text-muted-foreground text-sm">credits left</span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          OpenRouter account balance
        </p>
      </div>

      <div className="border-border rounded-lg border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {global.limitUsd != null
              ? fmtUsd(Math.max(0, global.limitUsd - global.weekSpendUsd))
              : "—"}
          </span>
          <span className="text-muted-foreground text-sm">budget left</span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          this week, against the global cap
        </p>
      </div>
    </div>
  );
}
