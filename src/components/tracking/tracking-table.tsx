"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { ReadinessBadge } from "./readiness-badge";
import { TrackingTimeline } from "./tracking-timeline";
import type {
  TrackingChange,
  ReadinessTag,
  Schedule,
} from "@/lib/types/tracking";
import { SCHEDULE_LABELS } from "@/lib/types/tracking";

export type ViewMode = "by-signal" | "by-company";

export interface TrackingRow {
  id: string;
  organizationName: string;
  organizationDomain: string | null;
  signalName: string;
  signalCategory: string;
  schedule: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  readinessTag: ReadinessTag | null;
  latestChangeDescription: string | null;
  latestChangeDate: string | null;
}

export interface CompanyGroup {
  organizationName: string;
  organizationDomain: string | null;
  readinessTag: ReadinessTag | null;
  activeSignals: number;
  lastRunAt: string | null;
  latestChangeDescription: string | null;
  rows: TrackingRow[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Square avatar tile + company name with mono domain subline (Aegis pattern).
function CompanyCell({
  name,
  domain,
}: {
  name: string;
  domain: string | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-muted text-muted-foreground flex size-7 flex-none items-center justify-center rounded-lg text-[10px] font-bold">
        {initials(name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        {domain && (
          <div className="text-muted-foreground truncate font-mono text-xs">
            {domain}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandableSignalRow({ row }: { row: TrackingRow }) {
  const [expanded, setExpanded] = useState(false);
  const [changes, setChanges] = useState<TrackingChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [localStatus, setLocalStatus] = useState(row.status);

  const toggleExpand = async () => {
    if (!expanded && changes.length === 0) {
      setLoadingChanges(true);
      try {
        const res = await fetch(
          `/api/tracking/changes?configId=${row.id}&limit=20`,
        );
        const data = await res.json();
        setChanges(Array.isArray(data) ? (data as TrackingChange[]) : []);
      } catch {
        // ignore errors — show empty timeline
      }
      setLoadingChanges(false);
    }
    setExpanded(!expanded);
  };

  const togglePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = localStatus === "active" ? "paused" : "active";
    setLocalStatus(newStatus);
    try {
      const res = await fetch(`/api/tracking/configs/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(
        newStatus === "paused" ? "Tracking paused" : "Tracking resumed",
      );
    } catch {
      toast.error("Failed to update tracking status");
      setLocalStatus(localStatus); // revert on failure
    }
  };

  return (
    <>
      <tr
        className="hover:bg-muted border-border cursor-pointer border-b transition-colors"
        onClick={toggleExpand}
      >
        <td className="w-8 py-3 pl-4 pr-1">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </td>
        <td className="px-3 py-3">
          <CompanyCell
            name={row.organizationName}
            domain={row.organizationDomain}
          />
        </td>
        <td className="text-muted-foreground px-3 py-3 text-sm">
          {row.signalName}
        </td>
        <td className="text-muted-foreground px-3 py-3 font-mono text-xs">
          {SCHEDULE_LABELS[row.schedule as Schedule] ?? row.schedule}
          {localStatus === "paused" ? " (paused)" : ""}
        </td>
        <td className="text-muted-foreground px-3 py-3 font-mono text-xs">
          {formatDate(row.lastRunAt)}
        </td>
        <td className="px-3 py-3 text-sm">
          {row.latestChangeDescription || (
            <span className="text-muted-foreground">No changes</span>
          )}
        </td>
        <td className="px-3 py-3">
          <ReadinessBadge tag={row.readinessTag} />
        </td>
        <td className="px-3 py-3 pr-4">
          <button
            type="button"
            onClick={togglePause}
            className="text-muted-foreground hover:text-foreground p-1 transition-colors"
            title={
              localStatus === "active" ? "Pause tracking" : "Resume tracking"
            }
          >
            {localStatus === "active" ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={8}
            className="bg-muted/40 border-border border-b px-6 py-3"
          >
            {loadingChanges ? (
              <p className="text-muted-foreground text-xs">Loading...</p>
            ) : (
              <TrackingTimeline changes={changes} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandableCompanyRow({ group }: { group: CompanyGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [changesByConfig, setChangesByConfig] = useState<
    Record<string, TrackingChange[]>
  >({});
  const [loadingChanges, setLoadingChanges] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && Object.keys(changesByConfig).length === 0) {
      setLoadingChanges(true);
      try {
        const configIds = group.rows.map((r) => r.id);
        const qs = configIds.map((id) => `configId=${id}`).join("&");
        const res = await fetch(`/api/tracking/changes?${qs}&limit=50`);
        const data = await res.json();

        const grouped: Record<string, TrackingChange[]> = {};
        for (const change of Array.isArray(data)
          ? (data as TrackingChange[])
          : []) {
          const cid = change.tracking_config_id;
          if (!grouped[cid]) grouped[cid] = [];
          grouped[cid].push(change);
        }
        setChangesByConfig(grouped);
      } catch {
        // ignore errors — show empty timelines
      }
      setLoadingChanges(false);
    }
    setExpanded(!expanded);
  };

  return (
    <>
      <tr
        className="hover:bg-muted border-border cursor-pointer border-b transition-colors"
        onClick={toggleExpand}
      >
        <td className="w-8 py-3 pl-4 pr-1">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </td>
        <td className="px-3 py-3">
          <CompanyCell
            name={group.organizationName}
            domain={group.organizationDomain}
          />
        </td>
        <td className="text-muted-foreground px-3 py-3 font-mono text-xs">
          {group.activeSignals} active
        </td>
        <td className="text-muted-foreground px-3 py-3 font-mono text-xs">
          {formatDate(group.lastRunAt)}
        </td>
        <td className="px-3 py-3 text-sm" colSpan={2}>
          {group.latestChangeDescription || (
            <span className="text-muted-foreground">No changes</span>
          )}
        </td>
        <td className="px-3 py-3">
          <ReadinessBadge tag={group.readinessTag} />
        </td>
        <td className="pr-4" />
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={8}
            className="bg-muted/40 border-border border-b px-6 py-3"
          >
            {loadingChanges ? (
              <p className="text-muted-foreground text-xs">Loading...</p>
            ) : (
              <div className="space-y-3">
                {group.rows.map((row) => (
                  <div key={row.id}>
                    <p className="text-xs font-medium">{row.signalName}</p>
                    <TrackingTimeline changes={changesByConfig[row.id] ?? []} />
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function TrackingTable({
  rows,
  viewMode,
}: {
  rows: TrackingRow[];
  viewMode: ViewMode;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-card shadow-card border-border rounded-xl border px-6 py-16 text-center">
        <p className="text-muted-foreground text-sm">
          No tracking configs found. Set up tracking in Chat to start monitoring
          companies.
        </p>
      </div>
    );
  }

  if (viewMode === "by-company") {
    // Group rows by organization
    const groupMap = new Map<string, CompanyGroup>();
    for (const row of rows) {
      const key = row.organizationDomain || row.organizationName;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          organizationName: row.organizationName,
          organizationDomain: row.organizationDomain,
          readinessTag: row.readinessTag,
          activeSignals: 0,
          lastRunAt: null,
          latestChangeDescription: null,
          rows: [],
        });
      }
      const group = groupMap.get(key)!;
      group.rows.push(row);
      if (row.status === "active") group.activeSignals++;
      // Use most recent run/change
      if (
        !group.lastRunAt ||
        (row.lastRunAt && row.lastRunAt > group.lastRunAt)
      ) {
        group.lastRunAt = row.lastRunAt;
      }
      if (
        row.latestChangeDate &&
        (!group.latestChangeDescription ||
          (group.latestChangeDescription &&
            row.latestChangeDate > (group.lastRunAt ?? "")))
      ) {
        group.latestChangeDescription = row.latestChangeDescription;
      }
      // Promote readiness: ready > monitoring > not_ready
      if (row.readinessTag === "ready_to_contact") {
        group.readinessTag = "ready_to_contact";
      } else if (
        row.readinessTag === "monitoring" &&
        group.readinessTag !== "ready_to_contact"
      ) {
        group.readinessTag = "monitoring";
      }
    }

    const groups = Array.from(groupMap.values());

    return (
      <div className="bg-card shadow-card border-border overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted border-border border-b">
                <th className="w-8 py-3 pl-4 pr-1" />
                <th className="eyebrow px-3 py-3 text-left">Company</th>
                <th className="eyebrow px-3 py-3 text-left">Signals</th>
                <th className="eyebrow px-3 py-3 text-left">Last Check</th>
                <th className="eyebrow px-3 py-3 text-left" colSpan={2}>
                  Latest Changes
                </th>
                <th className="eyebrow px-3 py-3 text-left">Status</th>
                <th className="w-10 pr-4" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <ExpandableCompanyRow
                  key={group.organizationName}
                  group={group}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // By signal (default)
  return (
    <div className="bg-card shadow-card border-border overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted border-border border-b">
              <th className="w-8 py-3 pl-4 pr-1" />
              <th className="eyebrow px-3 py-3 text-left">Company</th>
              <th className="eyebrow px-3 py-3 text-left">Signal</th>
              <th className="eyebrow px-3 py-3 text-left">Every</th>
              <th className="eyebrow px-3 py-3 text-left">Last Check</th>
              <th className="eyebrow px-3 py-3 text-left">Changes</th>
              <th className="eyebrow px-3 py-3 text-left">Status</th>
              <th className="w-10 pr-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ExpandableSignalRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
