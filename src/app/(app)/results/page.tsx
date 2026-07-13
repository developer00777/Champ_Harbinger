"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { Campaign } from "@/lib/types/campaign";

interface FieldCell {
  value: unknown;
  source: string;
  confidence: number;
  verified: boolean;
}

interface ResultRow {
  contactId: string;
  name: string | null;
  company: string | null;
  domain: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  seniority: string | null;
  linkedin: string | null;
  status: string;
  completenessScore: number;
  confidenceScore: number;
  fields: Record<string, FieldCell>;
}

const COMPLETENESS_OPTIONS = [
  { value: "", label: "Any completeness" },
  { value: "0.25", label: "≥ 25% complete" },
  { value: "0.5", label: "≥ 50% complete" },
  { value: "0.75", label: "≥ 75% complete" },
  { value: "1", label: "100% complete" },
];

const SOURCE_LABEL: Record<string, string> = {
  lakeb2b: "LakeB2B",
  owned_scrape: "Owned",
  caller_input: "Seed",
};

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading…</span>
        </div>
      }
    >
      <ResultsPageContent />
    </Suspense>
  );
}

function ResultsPageContent() {
  const searchParams = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>(
    searchParams.get("campaign") ?? "",
  );
  const [minCompleteness, setMinCompleteness] = useState<string>("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data) => {
        if (mountedRef.current) setCampaigns((data as Campaign[]) ?? []);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (campaignId) params.set("campaignId", campaignId);
    if (minCompleteness) params.set("minCompleteness", minCompleteness);
    const data = await fetch(`/api/enrich/results?${params}`).then((r) =>
      r.json(),
    );
    if (!mountedRef.current) return;
    setRows((data?.results as ResultRow[]) ?? []);
    setLoading(false);
  }, [campaignId, minCompleteness]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const exportCsv = useCallback(() => {
    const params = new URLSearchParams();
    if (campaignId) params.set("campaignId", campaignId);
    if (minCompleteness) params.set("minCompleteness", minCompleteness);
    window.location.href = `/api/enrich/export?${params}`;
  }, [campaignId, minCompleteness]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-1 font-mono text-[11px] tracking-wider uppercase">
              Stage 4 · Results
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Results</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Enriched contacts with per-field provenance. Filter by
              completeness and export CSV with sources attached.
            </p>
          </div>
          <Button onClick={exportCsv} disabled={rows.length === 0} size="sm">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-full max-w-xs sm:w-auto sm:min-w-[200px]">
            <Select
              id="campaign-select"
              value={campaignId}
              onValueChange={setCampaignId}
              placeholder="All campaigns"
              aria-label="Campaign"
              items={[
                { value: "", label: "All campaigns" },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div className="w-full max-w-xs sm:w-auto sm:min-w-[180px]">
            <Select
              id="completeness-select"
              value={minCompleteness}
              onValueChange={setMinCompleteness}
              placeholder="Any completeness"
              aria-label="Minimum completeness"
              items={COMPLETENESS_OPTIONS}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {loading ? "…" : `${rows.length} contacts`}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="bg-card shadow-card border-border rounded-xl border px-6 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              {loading
                ? "Loading results…"
                : "No enriched contacts match. Run the Enrich screen first."}
            </p>
          </div>
        ) : (
          <div className="bg-card shadow-card border-border overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-xs">
                    <th className="px-4 py-2.5 font-medium">Contact</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Phone</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Complete
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Conf.
                    </th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <ResultRowView key={row.contactId} row={row} />
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

function SourcePill({ cell }: { cell?: FieldCell }) {
  if (!cell) return null;
  const label = SOURCE_LABEL[cell.source] ?? cell.source;
  return (
    <span className="bg-muted text-muted-foreground ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium">
      {label}
    </span>
  );
}

function ResultRowView({ row }: { row: ResultRow }) {
  return (
    <tr className="border-border/60 hover:bg-accent/40 border-b last:border-0">
      <td className="px-4 py-2.5">
        <div className="font-medium">{row.name ?? "—"}</div>
        <div className="text-muted-foreground text-xs">
          {[row.title, row.company].filter(Boolean).join(" · ") ||
            row.domain ||
            "—"}
        </div>
      </td>
      <td className="px-4 py-2.5">
        {row.email ? (
          <span className="inline-flex items-center">
            <span className="font-mono text-xs">{row.email}</span>
            {row.fields.email?.verified && (
              <CheckCircle2 className="ml-1 h-3 w-3 text-emerald-500" />
            )}
            <SourcePill cell={row.fields.email} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.phone ? (
          <span className="inline-flex items-center">
            <span className="font-mono text-xs">{row.phone}</span>
            <SourcePill cell={row.fields.phone} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {Math.round(row.completenessScore * 100)}%
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {row.confidenceScore.toFixed(2)}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            row.status === "accepted"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {row.status}
        </span>
      </td>
    </tr>
  );
}
