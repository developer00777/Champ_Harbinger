import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";

/**
 * Key/value app configuration the super-admin edits from the console (e.g. the
 * default OpenRouter model, alert thresholds). Backed by the `app_settings`
 * table with a short in-process TTL cache so hot paths (model resolution on
 * every LLM entry point) don't hit the DB per request.
 *
 * Well-known keys:
 *   "default_model"     → string  (OpenRouter model id; admin-wide default)
 *   "alert_thresholds"  → number[] (fractions of a cap, e.g. [0.8, 1])
 *   "alert_sent:*"      → dedupe markers written by the usage-alert job
 */

export interface AppSettingsStoreDeps {
  fetchValue: (key: string) => Promise<unknown | undefined>;
  upsertValue: (
    key: string,
    value: unknown,
    updatedBy: string | null,
  ) => Promise<void>;
  ttlMs?: number;
  now?: () => number;
}

export interface AppSettingsStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, updatedBy?: string | null): Promise<void>;
  /** Drop a cached entry (or everything when key omitted). Mainly for tests. */
  invalidate(key?: string): void;
}

/**
 * Store factory with injectable persistence + clock so the cache behaviour is
 * unit-testable without a DB. `set` writes through the cache immediately, so a
 * process observes its own writes without waiting out the TTL.
 */
export function createAppSettingsStore(
  deps: AppSettingsStoreDeps,
): AppSettingsStore {
  const ttlMs = deps.ttlMs ?? 30_000;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { value: unknown | null; expiresAt: number }>();

  return {
    async get(key) {
      const t = now();
      const hit = cache.get(key);
      if (hit && hit.expiresAt > t) return hit.value;
      const raw = await deps.fetchValue(key);
      const value = raw === undefined ? null : raw;
      cache.set(key, { value, expiresAt: t + ttlMs });
      return value;
    },
    async set(key, value, updatedBy = null) {
      await deps.upsertValue(key, value, updatedBy);
      cache.set(key, { value, expiresAt: now() + ttlMs });
    },
    invalidate(key) {
      if (key === undefined) cache.clear();
      else cache.delete(key);
    },
  };
}

function appSettingsTtlMs(): number {
  const n = Number(process.env.APP_SETTINGS_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

// Default DB-backed store, pinned to globalThis so dev hot reloads share one
// cache (same pattern as the budget spend cache).
function defaultStore(): AppSettingsStore {
  const g = globalThis as typeof globalThis & {
    __harbinger_app_settings?: AppSettingsStore;
  };
  if (!g.__harbinger_app_settings) {
    g.__harbinger_app_settings = createAppSettingsStore({
      ttlMs: appSettingsTtlMs(),
      fetchValue: async (key) => {
        const [row] = await adminDb
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, key))
          .limit(1);
        return row === undefined ? undefined : row.value;
      },
      upsertValue: async (key, value, updatedBy) => {
        await adminDb
          .insert(schema.appSettings)
          .values({ key, value, updatedBy, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value, updatedBy, updatedAt: new Date() },
          });
      },
    });
  }
  return g.__harbinger_app_settings;
}

/** Cached read of one app setting. Returns null when unset. */
export async function getAppSetting(key: string): Promise<unknown | null> {
  return defaultStore().get(key);
}

/** Typed convenience: the value when it's a non-empty string, else null. */
export async function getAppSettingString(key: string): Promise<string | null> {
  const v = await getAppSetting(key);
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Upsert one app setting (write-through cache). */
export async function setAppSetting(
  key: string,
  value: unknown,
  updatedBy?: string | null,
): Promise<void> {
  return defaultStore().set(key, value, updatedBy ?? null);
}
