/**
 * Periodic reconciliation between the Harbinger-owned master DB and the LakeB2B
 * master DB.
 *
 * SP1 ships the signature + a guarded no-op. The owned master tables already
 * carry the columns this needs (lakeb2bId join key, lastSyncedAt, syncStatus),
 * so the full daily/weekly diff can be implemented later without a schema change
 * (product owner: "every day or week, later on"). When LAKEB2B_MASTER_DSN is
 * unset, sync is disabled and returns zeros.
 */

import { getSettings } from "./config";

export interface SyncResult {
  enabled: boolean;
  compared: number;
  updated: number;
  conflicts: number;
  note: string;
}

export async function syncWithLakeB2BMaster(): Promise<SyncResult> {
  const settings = getSettings();
  if (!settings.masterDbDsn) {
    return {
      enabled: false,
      compared: 0,
      updated: 0,
      conflicts: 0,
      note: "Sync disabled: LAKEB2B_MASTER_DSN is not set.",
    };
  }
  // Full reconciliation (diff owned master vs LakeB2B by lakeb2b_id/email,
  // recency-resolve conflicts, stamp last_synced_at + sync_status) is deferred.
  return {
    enabled: true,
    compared: 0,
    updated: 0,
    conflicts: 0,
    note: "Sync configured but the reconciliation pass is not yet implemented (deferred).",
  };
}
