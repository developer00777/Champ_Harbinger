import "server-only";

import { requireSuperAdmin } from "@/lib/auth";

/**
 * Runs `requireSuperAdmin()` and, on failure, returns a ready-to-send 403
 * Response so every admin route handler can early-return it. On success it
 * returns the super-admin's userId.
 *
 * Usage:
 *   const guard = await requireSuperAdminApi();
 *   if (guard instanceof Response) return guard;
 *   const { userId } = guard;
 */
export async function requireSuperAdminApi(): Promise<
  { userId: string } | Response
> {
  try {
    return await requireSuperAdmin();
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
}
