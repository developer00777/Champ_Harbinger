// Legacy Supabase admin client — kept for route handlers not yet migrated to Drizzle.
// @supabase/supabase-js is not installed; this module provides a compatible
// stub that satisfies TypeScript without requiring the package.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

let _client: SupabaseClient | null = null;

/**
 * Supabase client that bypasses RLS. Lazily initialized on first call.
 * Use ONLY for:
 * - QStash webhook handlers (no user session)
 * - Cost tracker fire-and-forget inserts (no cookie context)
 * - E2E test setup/teardown
 * Never expose this client to the browser.
 */
export function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is required to create the admin client.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to create the admin client. " +
        "Grab it from `supabase status -o env` (local) or Project Settings → API (hosted).",
    );
  }

  // Dynamic require so tsc does not need the package installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js") as {
    createClient: (url: string, key: string, opts?: unknown) => SupabaseClient;
  };
  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return _client;
}
