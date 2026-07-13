"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, Play, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { Campaign } from "@/lib/types/campaign";

interface Candidate {
  personId: string;
  name: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  email: string | null;
  linkedin: string | null;
}

interface FieldValueJson {
  value: unknown;
  source: string;
  confidence: number;
  verified: boolean;
}

type RunStatus = "idle" | "running" | "accepted" | "exhausted" | "failed";

interface RowState {
  candidate: Candidate;
  status: RunStatus;
  resolvedTier: string | null;
  fields: Record<string, FieldValueJson>;
  confidenceScore: number;
  cost: number;
  error?: string;
}

interface CampaignSettings {
  requiredFields: string[];
  budgetCapUsd: number | null;
}

// How the waterfall's coarse tiers read to a rep watching it run (spec §5).
const TIER_LABEL: Record<string, string> = {
  T0_master: "LakeB2B",
  T1_lakestream: "Owned scrape",
  T2_person: "Person API",
  T3_heavy: "Heavy API",
  T4_reseller: "Reseller",
};

const RUN_CONCURRENCY = 4;

export default function EnrichPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading…</span>
        </div>
      }
    >
      <EnrichPageContent />
    </Suspense>
  );
}

function EnrichPageContent() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get("campaign");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId ?? "",
  );
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data) => {
        if (!mountedRef.current) return;
        setCampaigns((data as Campaign[]) ?? []);
        setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCandidates = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setRows([]);
      setSettings(null);
      return;
    }
    const data = await fetch(
      `/api/enrich/candidates?campaignId=${encodeURIComponent(campaignId)}`,
    ).then((r) => r.json());
    if (!mountedRef.current) return;
    const candidates = (data?.candidates as Candidate[]) ?? [];
    setSettings({
      requiredFields: data?.campaign?.requiredFields ?? [],
      budgetCapUsd: data?.campaign?.budgetCapUsd ?? null,
    });
    setRows(
      candidates.map((c) => ({
        candidate: c,
        status: "idle" as const,
        resolvedTier: null,
        fields: {},
        confidenceScore: 0,
        cost: 0,
      })),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates(selectedCampaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId]);

  const patchRow = useCallback((index: number, patch: Partial<RowState>) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const runOne = useCallback(
    async (index: number, candidate: Candidate) => {
      patchRow(index, { status: "running", error: undefined });
      try {
        const res = await fetch("/api/enrich/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: candidate.name ?? undefined,
            company: candidate.company ?? undefined,
            domain: candidate.domain ?? undefined,
            email: candidate.email ?? undefined,
            linkedin: candidate.linkedin ?? undefined,
            externalRef: candidate.personId,
            requiredFields: settings?.requiredFields,
            budgetUsd: settings?.budgetCapUsd ?? undefined,
          }),
        });
        const data = await res.json();
        if (!mountedRef.current) return;
        if (!res.ok) {
          patchRow(index, {
            status: "failed",
            error: data?.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        patchRow(index, {
          status: data.status === "accepted" ? "accepted" : "exhausted",
          resolvedTier: data.resolvedTier ?? null,
          fields: data.fields ?? {},
          confidenceScore: data.confidenceScore ?? 0,
          cost: data.totalCostUsd ?? 0,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        patchRow(index, {
          status: "failed",
          error: err instanceof Error ? err.message : "Request failed",
        });
      }
    },
    [patchRow, settings],
  );

  const runAll = useCallback(async () => {
    setRunning(true);
    // Reset any prior run.
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        status: "idle" as const,
        resolvedTier: null,
        fields: {},
        confidenceScore: 0,
        cost: 0,
        error: undefined,
      })),
    );
    const snapshot = rows.map((r) => r.candidate);
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(RUN_CONCURRENCY, snapshot.length) },
      async () => {
        for (let i = cursor++; i < snapshot.length; i = cursor++) {
          await runOne(i, snapshot[i]);
        }
      },
    );
    await Promise.all(workers);
    if (mountedRef.current) setRunning(false);
  }, [rows, runOne]);

  const done = rows.filter(
    (r) =>
      r.status === "accepted" ||
      r.status === "exhausted" ||
      r.status === "failed",
  ).length;
  const accepted = rows.filter((r) => r.status === "accepted").length;
  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-1 font-mono text-[11px] tracking-wider uppercase">
              Stage 3 · Waterfall
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Enrich</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Watch the waterfall run per contact — LakeB2B first, then the
              gaps. Which tier filled each field, confidence, and spend, live.
            </p>
          </div>
          {rows.length > 0 && (
            <ul className="flex items-center gap-2" aria-label="Run summary">
              <li className="bg-muted text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
                <span className="tabular-nums">
                  {done}/{rows.length}
                </span>{" "}
                done
              </li>
              <li className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="tabular-nums">{accepted}</span> accepted
              </li>
              <li className="bg-peach text-primary inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
                <span className="tabular-nums">${totalCost.toFixed(4)}</span>{" "}
                spent
              </li>
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-full max-w-xs sm:w-auto sm:min-w-[220px]">
            <Select
              id="campaign-select"
              value={selectedCampaignId}
              onValueChange={setSelectedCampaignId}
              placeholder={loading ? "Loading…" : "Select a campaign"}
              aria-label="Campaign"
              items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          {settings && settings.requiredFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">requires</span>
              {settings.requiredFields.map((f) => (
                <span
                  key={f}
                  className="bg-muted text-foreground/80 inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium"
                >
                  {f}
                </span>
              ))}
              {settings.budgetCapUsd != null && (
                <span className="text-muted-foreground text-xs">
                  · cap ${settings.budgetCapUsd.toFixed(2)}/contact
                </span>
              )}
            </div>
          )}
          <div className="ml-auto">
            <Button
              onClick={runAll}
              disabled={running || rows.length === 0}
              size="sm"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {running ? "Running…" : "Run waterfall"}
            </Button>
          </div>
        </div>

        {!selectedCampaignId ? (
          <EmptyCard>Select a campaign to load its people.</EmptyCard>
        ) : rows.length === 0 ? (
          <EmptyCard>
            No people staged on this campaign yet. Discover or upload contacts
            first.
          </EmptyCard>
        ) : (
          <div className="bg-card shadow-card border-border overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-xs">
                    <th className="px-4 py-2.5 font-medium">Contact</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Resolved by</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Phone</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Conf.
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <EnrichRow key={row.candidate.personId ?? i} row={row} />
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

function EnrichRow({ row }: { row: RowState }) {
  const email = row.fields.email?.value as string | undefined;
  const emailVerified = row.fields.email?.verified;
  const phone = row.fields.phone?.value as string | undefined;
  return (
    <tr className="border-border/60 hover:bg-accent/40 border-b last:border-0">
      <td className="px-4 py-2.5">
        <div className="font-medium">{row.candidate.name ?? "—"}</div>
        <div className="text-muted-foreground text-xs">
          {[row.candidate.title, row.candidate.company]
            .filter(Boolean)
            .join(" · ") ||
            row.candidate.domain ||
            "—"}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <RunStatusPill status={row.status} />
        {row.error && (
          <div
            className="text-destructive mt-0.5 max-w-[200px] truncate text-[11px]"
            title={row.error}
          >
            {row.error}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.resolvedTier ? (
          <span className="bg-peach text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
            <Sparkles className="h-3 w-3" />
            {TIER_LABEL[row.resolvedTier] ?? row.resolvedTier}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {email ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-xs">{email}</span>
            {emailVerified && (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">{phone ?? "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {row.status === "idle" || row.status === "running"
          ? "—"
          : row.confidenceScore.toFixed(2)}
      </td>
      <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
        ${row.cost.toFixed(4)}
      </td>
    </tr>
  );
}

function RunStatusPill({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; cls: string }> = {
    idle: { label: "Queued", cls: "bg-muted text-muted-foreground" },
    running: {
      label: "Running",
      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    accepted: {
      label: "Accepted",
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    exhausted: {
      label: "Exhausted",
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card shadow-card border-border rounded-xl border px-6 py-16 text-center">
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}
