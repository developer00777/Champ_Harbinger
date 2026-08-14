import { auth } from "@clerk/nextjs/server";

import { devSession, isDevAuthBypass } from "./dev-auth";

export async function getCurrentUser() {
  if (isDevAuthBypass()) return devSession();
  const { userId, orgId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized: no Clerk session");
  }
  return { userId, orgId: orgId ?? null };
}

export async function getCurrentUserOrNull() {
  if (isDevAuthBypass()) return devSession();
  const { userId, orgId } = await auth();
  return userId ? { userId, orgId: orgId ?? null } : null;
}

/** Clerk user ids allowed into the super-admin console (env, pipe/comma/space separated). */
function superAdminIds(): string[] {
  return (process.env.SUPER_ADMIN_USER_IDS ?? "")
    .split(/[|,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSuperAdminId(userId: string | null | undefined): boolean {
  return !!userId && superAdminIds().includes(userId);
}

/**
 * Guards super-admin-only routes/pages. Throws if the caller is not in
 * SUPER_ADMIN_USER_IDS. Returns the super-admin's userId on success.
 */
export async function requireSuperAdmin() {
  const { userId } = await getCurrentUser();
  if (!superAdminIds().includes(userId)) {
    throw new Error("Forbidden: super-admin only");
  }
  return { userId };
}
