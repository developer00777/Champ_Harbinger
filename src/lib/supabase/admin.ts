import "server-only";

// Legacy Supabase admin client — kept for route handlers not yet migrated to Drizzle.
// @supabase/supabase-js is not installed; this module provides a no-op stub
// that satisfies call sites without requiring the package at runtime.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

let _client: SupabaseClient | null = null;

/**
 * Supabase admin stub that bypasses RLS. Lazily initialized on first call.
 * Returns a no-op object while routes are migrated to Drizzle.
 * All queries return `{ data: null, error: null, count: null }`.
 *
 * Use ONLY for:
 * - QStash webhook handlers (no user session)
 * - Cost tracker fire-and-forget inserts (no cookie context)
 * - E2E test setup/teardown
 * Never expose this client to the browser.
 */
export function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const noop = (): Promise<{ data: null; error: null; count: null }> =>
    Promise.resolve({ data: null, error: null, count: null });

  const builder = (): unknown => {
    const b: Record<string, unknown> = {};
    const chain = [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "neq",
      "lt",
      "lte",
      "gt",
      "gte",
      "is",
      "in",
      "contains",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "match",
      "filter",
      "not",
      "or",
    ];
    for (const method of chain) {
      b[method] = (..._args: unknown[]) => b;
    }
    b["then"] = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: null, error: null, count: null }).then(resolve);
    return b;
  };

  _client = {
    from: (_table: string) => builder(),
    rpc: noop,
    storage: {
      from: () => ({
        upload: noop,
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
    auth: { getUser: noop, signOut: noop },
  };

  return _client;
}
