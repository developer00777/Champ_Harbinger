"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { StatCards } from "@/components/dashboard/stat-cards";
import { CampaignTable } from "@/components/dashboard/campaign-table";
import { ChampIQQueueWidget } from "@/components/dashboard/champiq-queue-widget";
import { QuickStartHub } from "@/components/quick-start/quick-start-hub";
import {
  ListRowsSkeleton,
  StatsRowSkeleton,
} from "@/components/ui/skeleton-presets";

const OutreachChart = dynamic(
  () =>
    import("@/components/dashboard/outreach-chart").then(
      (m) => m.OutreachChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />
    ),
  },
);

interface DashboardData {
  totals: {
    leads: number;
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
  };
  timeSeries: Array<{
    date: string;
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    leads: number;
    sent: number;
    opened: number;
    openRate: number;
    replied: number;
    replyRate: number;
  }>;
  topSignals?: Array<{ name: string; count: number }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [range, setRange] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topSignals, setTopSignals] = useState<
    { name: string; count: number }[]
  >([]);

  const fetchData = useCallback(async (r: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setTopSignals(json.topSignals ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[dashboard] Failed to fetch:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData(range);
  }, [range, fetchData]);

  const handleRangeChange = (newRange: string) => {
    setRange(newRange);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-8 p-4 md:p-6 lg:px-8 lg:py-7">
        {/* Hero: the Quick Start flow */}
        <QuickStartHub />

        {/* Cross-campaign performance */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Performance</h2>

          <ChampIQQueueWidget />

          {loading && !data ? (
            <div className="space-y-6">
              <StatsRowSkeleton count={4} />
              <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />
              <ListRowsSkeleton count={3} />
            </div>
          ) : !data ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-10">
              <p className="text-muted-foreground text-sm">
                {error
                  ? `Failed to load performance: ${error}`
                  : "Failed to load performance"}
              </p>
              <button
                type="button"
                onClick={() => fetchData(range)}
                className="bg-foreground/10 hover:bg-foreground/15 rounded-md px-3 py-1.5 text-xs font-medium"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <StatCards totals={data.totals} />

              <OutreachChart
                timeSeries={data.timeSeries}
                range={range}
                onRangeChange={handleRangeChange}
              />

              {topSignals.length > 0 && (
                <section className="rounded-xl border border-border p-4">
                  <p className="eyebrow mb-3">Top signals fired</p>
                  <div className="space-y-2">
                    {topSignals.map((s) => (
                      <div
                        key={s.name}
                        className="flex justify-between text-sm"
                      >
                        <span>{s.name}</span>
                        <span className="text-champions-orange font-medium">
                          {s.count}×
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div>
                <h3 className="mb-3 text-base font-semibold">Campaigns</h3>
                <CampaignTable campaigns={data.campaigns} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
