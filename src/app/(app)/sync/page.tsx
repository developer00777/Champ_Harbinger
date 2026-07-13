"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";

interface QueueRow {
  id: string;
  fullName: string | null;
  email: string | null;
  companyName: string | null;
  title: string | null;
  seniority: string | null;
  confidence: string | number | null;
  verified: boolean;
  source: string | null;
  lastVerified: string | null;
}

export default function SyncPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/sync/queue").then((r) => r.json());
    if (!mountedRef.current) return;
    const queue = (data?.queue as QueueRow[]) ?? [];
    setRows(queue);
    setSelected(new Set(queue.map((r) => r.id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }, [rows]);

  const sync = useCallback(async () => {
    if (selected.size === 0) return;
    setSyncing(true);
    setLastResult(null);
    const res = await fetch("/api/sync/master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const data = await res.json();
    if (!mountedRef.current) return;
    if (res.ok) {
      setLastResult(
        `Synced ${data.synced} to master${
          data.skipped?.length ? ` · ${data.skipped.length} skipped` : ""
        }.`,
      );
      await load();
    } else {
      setLastResult(data?.error ?? "Sync failed");
    }
    setSyncing(false);
  }, [selected, load]);

  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-1 font-mono text-[11px] tracking-wider uppercase">
              Stage 5 · Sync
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Sync queue</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Verified contacts staged for the LakeB2B master. Approve a batch
              and push — today&apos;s enriched contact is tomorrow&apos;s Tier
              0.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={sync}
              disabled={syncing || selected.size === 0}
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
              )}
              {syncing ? "Syncing…" : `Sync ${selected.size} to master`}
            </Button>
          </div>
        </div>

        {lastResult && (
          <div className="bg-peach text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            {lastResult}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="bg-card shadow-card border-border rounded-xl border px-6 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              {loading
                ? "Loading queue…"
                : "Nothing staged. Accepted contacts land here automatically after enrichment."}
            </p>
          </div>
        ) : (
          <div className="bg-card shadow-card border-border overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-xs">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        aria-label="Select all"
                        className="accent-primary border-border h-4 w-4 rounded"
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">Contact</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Conf.
                    </th>
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-4 py-2.5 font-medium">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-border/60 hover:bg-accent/40 border-b last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.fullName ?? row.id}`}
                          className="accent-primary border-border h-4 w-4 rounded"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{row.fullName ?? "—"}</div>
                        <div className="text-muted-foreground text-xs">
                          {[row.title, row.companyName]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {row.email ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.confidence != null
                          ? Number(row.confidence).toFixed(2)
                          : "—"}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-xs">
                        {row.source ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.verified ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            unverified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
