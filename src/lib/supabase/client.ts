"use client";

// Legacy Supabase browser client — kept for pages not yet migrated to Drizzle.
// @supabase/ssr is not installed; this module provides a compatible stub that
// satisfies TypeScript without requiring the package at compile time.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

interface ClerkWindow {
  Clerk?: {
    session?: { getToken: () => Promise<string | null> };
  };
}

/**
 * Browser Supabase client that forwards the Clerk session token as a Bearer
 * header on every request.
 */
export const createClient = (): SupabaseClient => {
  // Dynamic require so tsc does not need the package installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createBrowserClient } = require("@supabase/ssr") as {
    createBrowserClient: (
      url: string,
      key: string,
      opts?: unknown,
    ) => SupabaseClient;
  };
  return createBrowserClient(supabaseUrl!, supabaseKey!, {
    global: {
      fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const token =
          typeof window !== "undefined"
            ? await ((
                window as unknown as ClerkWindow
              ).Clerk?.session?.getToken() ?? null)
            : null;
        const headers = new Headers(init.headers as HeadersInit | undefined);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
};
