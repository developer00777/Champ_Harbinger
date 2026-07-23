"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings/settings-section";
import { fmtLimit, fmtUsd, spendToneClass } from "@/components/admin/format";
import type {
  AnalyticsPayload,
  AnalyticsUserRow,
} from "@/app/api/admin/analytics/route";

/** Percent-of-cap as a compact label ("42%", "—" when unlimited). */
function fmtPct(p: number | null): string {
  return p == null ? "—" : `${Math.round(p * 100)}%`;
}

async function fetchAnalytics(): Promise<AnalyticsPayload | null> {
  try {
    const res = await fetch("/api/admin/analytics");
    if (!res.ok) return null;
    return (await res.json()) as AnalyticsPayload;
  } catch {
    return null;
  }
}

function parseLimit(v: string): number | null | undefined {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Pure-CSS vertical bar chart (no chart deps). */
function BarChart({
  points,
}: {
  points: Array<{ label: string; value: number; sublabel?: string }>;
}) {
  const max = Math.max(...points.map((p) => p.value), 0.000001);
  return (
    <div className="flex h-40 items-end gap-[3px] overflow-x-auto pt-2">
      {points.map((p) => (
        <div
          key={p.label}
          className="group relative flex min-w-[10px] flex-1 flex-col items-center justify-end self-stretch"
          title={`${p.label}: ${fmtUsd(p.value)}${p.sublabel ? ` · ${p.sublabel}` : ""}`}
        >
          <div
            className="bg-primary/70 group-hover:bg-primary w-full rounded-t-sm transition-colors"
            style={{
              height: `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Horizontal proportion bars for category breakdowns. */
function BreakdownBars({
  rows,
}: {
  rows: Array<{ label: string; costUsd: number; calls: number }>;
}) {
  const max = Math.max(...rows.map((r) => r.costUsd), 0.000001);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums text-xs">
              {fmtUsd(r.costUsd)} · {r.calls.toLocaleString()} calls
            </span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary/70 h-full rounded-full"
              style={{ width: `${(r.costUsd / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsageAnalytics() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // Inline limit editing: "<memberId>:week" | "<memberId>:day"
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await fetchAnalytics();
      if (!alive) return;
      if (d) setData(d);
      else toast.error("Failed to load usage analytics");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const d = await fetchAnalytics();
    if (d) setData(d);
    else toast.error("Failed to load usage analytics");
    setLoading(false);
  }, []);

  async function saveLimit(
    row: AnalyticsUserRow,
    period: "week" | "day",
  ): Promise<void> {
    if (!row.memberId) return;
    const parsed = parseLimit(draft);
    if (parsed === undefined) {
      toast.error("Limit must be a non-negative number (or blank to clear)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/members/${row.memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          period === "week"
            ? { perUserWeeklyLimitUsd: parsed }
            : { perUserDailyLimitUsd: parsed },
        ),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "Request failed");
      }
      setEditing(null);
      toast.success("Limit updated");
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update limit",
      );
    } finally {
      setBusy(false);
    }
  }

  function limitCell(row: AnalyticsUserRow, period: "week" | "day") {
    const key = `${row.memberId}:${period}`;
    const effective =
      period === "week" ? row.weeklyLimitUsd : row.dailyLimitUsd;
    const override =
      period === "week" ? row.perUserWeeklyLimitUsd : row.perUserDailyLimitUsd;
    if (!row.memberId) {
      return (
        <span className="text-muted-foreground">{fmtLimit(effective)}</span>
      );
    }
    if (editing === key) {
      return (
        <div className="flex items-center justify-end gap-1">
          <Input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="(default)"
            className="h-7 w-24"
            onKeyDown={(e) => {
              if (e.key === "Enter") saveLimit(row, period);
              if (e.key === "Escape") setEditing(null);
            }}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Save limit"
            disabled={busy}
            onClick={() => saveLimit(row, period)}
          >
            <Check />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            <X />
          </Button>
        </div>
      );
    }
    return (
      <button
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 tabular-nums"
        onClick={() => {
          setEditing(key);
          setDraft(override == null ? "" : String(override));
        }}
      >
        {fmtLimit(effective)}
        <Pencil className="h-3 w-3 opacity-60" />
      </button>
    );
  }

  if (loading && !data) {
    return (
      <SettingsSection
        title="Analytics"
        description="Spend and usage over the last 30 days."
      >
        <p className="text-muted-foreground text-sm">Loading analytics…</p>
      </SettingsSection>
    );
  }
  if (!data) {
    return (
      <SettingsSection
        title="Analytics"
        description="Spend and usage over the last 30 days."
      >
        <p className="text-muted-foreground text-sm">
          Analytics unavailable.{" "}
          <button className="underline" onClick={refresh}>
            Retry
          </button>
        </p>
      </SettingsSection>
    );
  }

  const total30d = data.dailySeries.reduce((s, p) => s + p.costUsd, 0);
  const totalCalls = data.dailySeries.reduce((s, p) => s + p.calls, 0);

  return (
    <SettingsSection
      title="Analytics"
      description={`Last 30 days: ${fmtUsd(total30d)} across ${totalCalls.toLocaleString()} API calls.`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Daily spend bar chart */}
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-widest">
            Daily spend (30d)
          </p>
          {data.dailySeries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No usage recorded yet.
            </p>
          ) : (
            <BarChart
              points={data.dailySeries.map((p) => ({
                label: p.date,
                value: p.costUsd,
                sublabel: `${p.calls.toLocaleString()} calls`,
              }))}
            />
          )}
        </div>

        {/* Service / operation breakdowns */}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
              By service (30d)
            </p>
            {data.byService.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data.</p>
            ) : (
              <BreakdownBars
                rows={data.byService.map((s) => ({
                  label: s.service,
                  costUsd: s.costUsd,
                  calls: s.calls,
                }))}
              />
            )}
          </div>
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
              Top operations (30d)
            </p>
            {data.byOperation.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data.</p>
            ) : (
              <BreakdownBars
                rows={data.byOperation.map((o) => ({
                  label: `${o.service} · ${o.operation}`,
                  costUsd: o.costUsd,
                  calls: o.calls,
                }))}
              />
            )}
          </div>
        </div>

        {/* Per-user table */}
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">
            Top spenders (30d)
          </p>
          {data.byUser.length === 0 ? (
            <p className="text-muted-foreground text-sm">No user spend yet.</p>
          ) : (
            <div className="border-border overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border bg-muted/50 border-b">
                    <th className="px-4 py-2.5 text-left font-medium">User</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      30d spend
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Week</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Weekly cap
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">% wk</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Today
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Daily cap
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      % day
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.map((u) => (
                    <tr
                      key={u.clerkUserId}
                      className="border-border border-b last:border-b-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium">
                          {u.email ?? u.clerkUserId}
                        </span>
                        {u.teamName && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {u.teamName}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtUsd(u.spend30dUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {fmtUsd(u.weekSpendUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {limitCell(u, "week")}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${spendToneClass(u.weekPctUsed)}`}
                      >
                        {fmtPct(u.weekPctUsed)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {fmtUsd(u.daySpendUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {limitCell(u, "day")}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${spendToneClass(u.dayPctUsed)}`}
                      >
                        {fmtPct(u.dayPctUsed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
