export type Schedule =
  | "every_15_min"
  | "hourly"
  | "every_6_hours"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom";

export type TrackingStatus = "active" | "paused" | "completed";

export type ReadinessTag = "ready_to_contact" | "monitoring" | "not_ready";

export interface TrackingConfig {
  id: string;
  campaign_id: string;
  organization_id: string | null;
  person_id: string | null;
  signal_id: string;
  schedule: Schedule;
  intent: string;
  status: TrackingStatus;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingSnapshot {
  id: string;
  tracking_config_id: string;
  snapshot_data: Record<string, unknown>;
  snapshot_hash: string;
  captured_at: string;
}

export type ChangeType =
  | "added"
  | "removed"
  | "count_change"
  | "threshold_crossed";

export interface TrackingChange {
  id: string;
  tracking_config_id: string;
  change_type: ChangeType;
  field_path: string | null;
  previous_value: unknown;
  current_value: unknown;
  description: string;
  detected_at: string;
}

/** Hiring-specific snapshot shape stored in tracking_snapshots.snapshot_data */
export interface HiringSnapshot {
  job_count: number;
  jobs: Array<{ title: string; department?: string; location?: string }>;
  by_department: Record<string, number>;
  careers_url: string | null;
}

export interface HiringDiff {
  added_jobs: Array<{ title: string; department?: string; location?: string }>;
  removed_jobs: Array<{
    title: string;
    department?: string;
    location?: string;
  }>;
  job_count_delta: number;
  department_deltas: Record<string, number>;
  classified_added: Array<{ title: string; category: string }>;
}

/** Schedule interval in milliseconds */
export const SCHEDULE_INTERVALS: Record<Exclude<Schedule, "custom">, number> = {
  every_15_min: 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  every_6_hours: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Minimum interval the dispatcher can reliably service (it ticks every 5 min by
 * default — TRACKING_DISPATCH_CRON). Custom intervals are floored to this.
 */
export const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Human-readable labels for the schedule values (UI display). */
export const SCHEDULE_LABELS: Record<Schedule, string> = {
  every_15_min: "Every 15 min",
  hourly: "Hourly",
  every_6_hours: "Every 6 hours",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  custom: "Custom",
};

/**
 * Resolve a schedule (plus optional custom minutes) to an interval in ms.
 * `custom` uses customIntervalMinutes, floored to MIN_INTERVAL_MS; unknown
 * schedules fall back to weekly.
 */
export function getScheduleIntervalMs(
  schedule: string,
  customIntervalMinutes?: number | null,
): number {
  if (schedule === "custom") {
    const ms = (customIntervalMinutes ?? 0) * 60 * 1000;
    return ms > 0 ? Math.max(MIN_INTERVAL_MS, ms) : SCHEDULE_INTERVALS.daily;
  }
  return (
    SCHEDULE_INTERVALS[schedule as Exclude<Schedule, "custom">] ??
    SCHEDULE_INTERVALS.weekly
  );
}
