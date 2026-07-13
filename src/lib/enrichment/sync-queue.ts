/**
 * Pure planner for the master-DB sync writer (spec §8 / §9 screen 5).
 *
 * Given the ids currently STAGED (master_contacts.syncStatus = 'local_only') and
 * an optional set the operator explicitly selected, decide which rows actually
 * get pushed. A requested id that is not staged (already synced, or not in this
 * operator's scope) is skipped, never silently synced.
 */
export interface SyncPlan {
  toSync: string[];
  skipped: string[];
}

export function planMasterSync(
  stagedIds: string[],
  requestedIds: string[] | null,
): SyncPlan {
  const staged = new Set(stagedIds);
  if (requestedIds === null) {
    return { toSync: [...stagedIds], skipped: [] };
  }
  const seen = new Set<string>();
  const toSync: string[] = [];
  const skipped: string[] = [];
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (staged.has(id)) toSync.push(id);
    else skipped.push(id);
  }
  return { toSync, skipped };
}
