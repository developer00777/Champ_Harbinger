import "server-only";

// Legacy Supabase server client — kept for route handlers not yet migrated to Drizzle.
// @supabase/ssr is not installed; this module provides a no-op stub that
// satisfies call sites without requiring the package at runtime.

import { auth } from "@clerk/nextjs/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

/**
 * Server Supabase stub. Returns a no-op object so route handlers don't crash
 * while these routes are being migrated to Drizzle.
 * All queries return `{ data: null, error: null, count: null }`.
 */
const makeStub = (): SupabaseClient => {
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

export const createClient = async (): Promise<SupabaseClient> => {
  return makeStub();
};

/**
 * Returns the Supabase client and current user for route handlers.
 * Returns null if not authenticated.
 */
export async function getSupabaseAndUser(): Promise<{
  supabase: SupabaseClient;
  user: { id: string; email: string };
} | null> {
  const { isAuthenticated, userId, sessionClaims } = await auth();
  if (!isAuthenticated || !userId) return null;
  const supabase = makeStub();
  const email =
    (sessionClaims as { email?: string } | null | undefined)?.email ?? "";
  return { supabase, user: { id: userId, email } };
}
