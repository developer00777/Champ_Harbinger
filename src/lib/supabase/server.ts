// Legacy Supabase server client — kept for route handlers not yet migrated to Drizzle.
// @supabase/ssr is not installed; this module provides a compatible stub that
// satisfies TypeScript without requiring the package at compile time.

import { auth } from "@clerk/nextjs/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

let warnedKeyless = false;
function warnIfKeyless() {
  if (warnedKeyless) return;
  if (process.env.CLERK_FRONTEND_API_DOMAIN) return;
  if (process.env.NODE_ENV === "production") {
    warnedKeyless = true;
    console.error(
      "FATAL: CLERK_FRONTEND_API_DOMAIN is unset in production. " +
        "Supabase third-party auth is disabled and every RLS-protected " +
        "query will return zero rows. Configure Clerk → Supabase before " +
        "serving traffic.",
    );
    return;
  }
  warnedKeyless = true;
  console.warn(
    "\n⚠ Clerk Keyless mode detected\n" +
      "  Supabase third-party auth is disabled because CLERK_FRONTEND_API_DOMAIN\n" +
      "  is not set. All RLS-protected queries will return empty rows.\n" +
      "  Fix: rerun `pnpm setup` (option [2]) or paste the domain into .env.local.\n" +
      "  See: https://clerk.com/setup/supabase\n",
  );
}

export const createClient = async (): Promise<SupabaseClient> => {
  warnIfKeyless();
  const { getToken } = await auth();

  // Dynamic require so tsc does not need the package installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createServerClient } = require("@supabase/ssr") as {
    createServerClient: (
      url: string,
      key: string,
      opts?: unknown,
    ) => SupabaseClient;
  };
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: { getAll: () => [], setAll: () => {} },
    global: {
      fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const token = await getToken();
        const headers = new Headers(init.headers as HeadersInit | undefined);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
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
  const supabase = await createClient();
  const email =
    (sessionClaims as { email?: string } | null | undefined)?.email ?? "";
  return { supabase, user: { id: userId, email } };
}
