"use client";

// Legacy Supabase browser client — kept for pages not yet migrated to Drizzle.
// @supabase/ssr is not installed; this module returns a no-op stub that
// satisfies call sites without requiring the package at runtime.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

/**
 * Browser Supabase stub. Returns a no-op object so call sites don't crash
 * while these pages are being migrated to Drizzle / API routes.
 * All queries return `{ data: null, error: null, count: null }`.
 */
export const createClient = (): SupabaseClient => {
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

  return {
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
};
