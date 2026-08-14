/**
 * Local-development auth bypass.
 *
 * Lets a developer run the app without a usable Clerk session — e.g. when the
 * shared Clerk dev instance has sign-ups restricted, or when working offline.
 *
 * SAFETY: this is inert unless BOTH conditions hold:
 *   1. DEV_AUTH_BYPASS=1
 *   2. NODE_ENV !== "production"
 *
 * The NODE_ENV half is the important one: `next build` / `next start` and every
 * hosted deploy (Railway, Vercel) set NODE_ENV=production, so even if the flag
 * leaks into a deployed environment the bypass stays off. Never remove that
 * check — the flag alone must never be enough to disable auth.
 */

/** The fake Clerk user id assumed when the bypass is active. */
export const DEV_USER_ID =
  process.env.DEV_AUTH_USER_ID ?? "user_3FUXbFpRkGJwBZ4AsALgKQi6xrc";

/** The email attached to the fake dev user. */
export const DEV_USER_EMAIL =
  process.env.DEV_AUTH_USER_EMAIL ?? "dev@localhost.test";

export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1"
  );
}

/** Shape returned by `getCurrentUser()` / `getCurrentUserOrNull()`. */
export function devSession(): { userId: string; orgId: string | null } {
  return { userId: DEV_USER_ID, orgId: null };
}

/**
 * Minimal stand-in for Clerk's `currentUser()`. Only the fields the app
 * actually reads are populated: `id`, `primaryEmailAddress`, `emailAddresses`,
 * plus first/last name for the account menu.
 */
export function devCurrentUser() {
  const emailAddress = DEV_USER_EMAIL;
  return {
    id: DEV_USER_ID,
    firstName: "Local",
    lastName: "Dev",
    fullName: "Local Dev",
    imageUrl: "",
    primaryEmailAddress: { emailAddress },
    emailAddresses: [{ emailAddress, id: "idn_dev" }],
  };
}
