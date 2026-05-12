"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TogglePill } from "@/components/ui/toggle-pill";
import {
  TrackingTable,
  type TrackingRow,
  type ViewMode,
} from "@/components/tracking/tracking-table";
import { ReadinessBadge } from "@/components/tracking/readiness-badge";
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
        <div className="space-y-6 p-4 md:p-6">
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tracking</h1>
          <p className="text-muted-foreground text-sm">
            Monitor companies over time. Signals run on schedule and flag
            entities when thresholds are met.
          </p>
        </div>

        {/* Campaign selector + stats */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full max-w-xs">
            <label
              htmlFor="campaign-select"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              Campaign
            </label>
            <Select
              id="campaign-select"
              value={selectedCampaignId}
              onValueChange={setSelectedCampaignId}
              placeholder="Select a campaign"
              items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          {selectedCampaignId && rows.length > 0 && (
            <ul className="flex gap-3" aria-label="Readiness counts">
              <li className="flex items-center gap-1.5">
                <ReadinessBadge tag="ready_to_contact" />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {readyCount}
                </span>
              </li>
              <li className="flex items-center gap-1.5">
                <ReadinessBadge tag="monitoring" />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {monitoringCount}
                </span>
              </li>
            </ul>
          )}
        </div>

        <Separator />

        {/* View toggle */}
        {selectedCampaignId && rows.length > 0 && (
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

        {/* Table */}
        {!selectedCampaignId ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Select a campaign to view tracked entities.
          </p>
        ) : rows.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
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
