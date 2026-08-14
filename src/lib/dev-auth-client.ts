"use client";

import { useAuth, useUser } from "@clerk/nextjs";

/**
 * Client-side counterpart to src/lib/dev-auth.ts.
 *
 * The server bypass makes protected routes render without a Clerk session, but
 * client components calling Clerk's `useUser()` / `useAuth()` still see
 * "signed out" — Clerk's browser SDK has no session to read. That left the
 * account menu blank and any userId-keyed client fetch unkeyed.
 *
 * These hooks return a synthetic identity when the bypass is on, and delegate
 * to the real Clerk hooks otherwise.
 *
 * SAFETY: gated on NEXT_PUBLIC_DEV_AUTH_BYPASS *and* NODE_ENV !== production.
 * Next.js inlines both at build time, so a production build compiles this to
 * the plain Clerk path. Keep the NODE_ENV check — the flag alone must never be
 * enough to fake an identity.
 */

export function isDevAuthBypassClient(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1"
  );
}

const DEV_USER_ID =
  process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID || "user_dev_local";
const DEV_USER_EMAIL =
  process.env.NEXT_PUBLIC_DEV_AUTH_USER_EMAIL || "dev@localhost.test";

/** `useAuth()` with a dev fallback for `userId`. */
export function useAuthOrDev(): { userId: string | null | undefined } {
  const real = useAuth();
  if (isDevAuthBypassClient()) return { userId: DEV_USER_ID };
  return { userId: real.userId };
}

/** Minimal `user` shape the UI reads — mirrors the Clerk fields in use. */
export interface DevAwareUser {
  id: string;
  fullName: string | null;
  username: string | null;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
}

/** `useUser()` with a dev fallback for the whole user object. */
export function useUserOrDev(): {
  user: DevAwareUser | null;
  isLoaded: boolean;
} {
  const real = useUser();
  if (isDevAuthBypassClient()) {
    return {
      isLoaded: true,
      user: {
        id: DEV_USER_ID,
        fullName: "Local Dev",
        username: "localdev",
        imageUrl: "",
        primaryEmailAddress: { emailAddress: DEV_USER_EMAIL },
      },
    };
  }
  return {
    isLoaded: real.isLoaded,
    user: (real.user as DevAwareUser | null) ?? null,
  };
}
