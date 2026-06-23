"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Select } from "@/components/ui/select";
import { TogglePill } from "@/components/ui/toggle-pill";
import {
  TrackingTable,
  type TrackingRow,
  type ViewMode,
} from "@/components/tracking/tracking-table";
import type { Campaign } from "@/lib/types/campaign";

export default function TrackingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      }
    >
      <TrackingPageContent />
    </Suspense>
  );
}

function TrackingPageContent() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get("campaign");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId ?? "",
  );
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("by-signal");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch("/api/campaigns").then((r) => r.json());
    if (!mountedRef.current) return;
    setCampaigns((data as Campaign[]) ?? []);
    setLoading(false);
  }, []);

  const fetchTrackingData = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setRows([]);
      return;
    }

    const params = new URLSearchParams({ campaignId });
    const data = await fetch(`/api/tracking-data?${params}`).then((r) =>
      r.json(),
    );

    if (!mountedRef.current) return;
    setRows((data as TrackingRow[]) ?? []);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchCampaigns();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTrackingData(selectedCampaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId]);

  // Count unique companies per readiness tag (not per config row)
  const readyCompanies = new Set(
    rows
      .filter((r) => r.readinessTag === "ready_to_contact")
      .map((r) => r.organizationDomain || r.organizationName),
  );
  const monitoringCompanies = new Set(
    rows
      .filter((r) => r.readinessTag === "monitoring")
      .map((r) => r.organizationDomain || r.organizationName),
  );
  const readyCount = readyCompanies.size;
  const monitoringCount = monitoringCompanies.size;

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tracking</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const showCounts = Boolean(selectedCampaignId) && rows.length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        {/* Header: title + subtitle, readiness counts on the right */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tracking</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Monitor companies over time. Signals run on schedule and flag
              entities when thresholds are met.
            </p>
          </div>

          {showCounts && (
            <ul
              className="flex items-center gap-2"
              aria-label="Readiness counts"
            >
              <li className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="tabular-nums">{readyCount}</span> ready to
                contact
              </li>
              <li className="bg-muted text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
                <span className="bg-muted-foreground h-1.5 w-1.5 rounded-full" />
                <span className="tabular-nums">{monitoringCount}</span>{" "}
                monitoring
              </li>
            </ul>
          )}
        </div>

        {/* Campaign selector + view toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-full max-w-xs sm:w-auto sm:min-w-[200px]">
            <Select
              id="campaign-select"
              value={selectedCampaignId}
              onValueChange={setSelectedCampaignId}
              placeholder="Select a campaign"
              aria-label="Campaign"
              items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          {showCounts && (
            <div className="flex gap-1.5">
              <TogglePill
                active={viewMode === "by-signal"}
                onClick={() => setViewMode("by-signal")}
              >
                By Signal
              </TogglePill>
              <TogglePill
                active={viewMode === "by-company"}
                onClick={() => setViewMode("by-company")}
              >
                By Company
              </TogglePill>
            </div>
          )}
        </div>

        {/* Table */}
        {!selectedCampaignId ? (
          <div className="bg-card shadow-card border-border rounded-xl border px-6 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              Select a campaign to view tracked entities.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-card shadow-card border-border flex flex-col items-center gap-2 rounded-xl border px-6 py-16 text-center">
            <p className="text-sm font-medium">
              No tracking configured for this campaign
            </p>
            <p className="text-muted-foreground text-xs">
              Enable a signal on a company to start tracking it over time.
            </p>
          </div>
        ) : (
          <TrackingTable rows={rows} viewMode={viewMode} />
        )}
      </div>
    </div>
  );
}
