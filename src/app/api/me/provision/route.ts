import { currentUser } from "@clerk/nextjs/server";

import { ensureProvisioned } from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * POST /api/me/provision
 *
 * First-login provisioning: links a pending team invite (matched by email) to
 * the calling Clerk user. Idempotent — no-ops once linked.
 *
 * This used to run inside `(app)/layout.tsx`, i.e. on every authed page render.
 * That was the ONLY database call in the render path, and it is what forced the
 * Vercel frontend to hold DATABASE_URL in the split deploy. Moving it behind an
 * API route lets the frontend render with no database access at all — the call
 * now happens on the backend that owns the data.
 *
 * Best-effort by design: `ensureProvisioned` swallows its own errors so a
 * transient DB problem can never block a user, and this route mirrors that.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;

  await ensureProvisioned(user.id, email);

  return Response.json({ ok: true });
}
