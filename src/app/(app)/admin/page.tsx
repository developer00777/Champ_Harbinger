import { redirect } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth";
import { AdminConsoleLoader } from "@/components/admin/admin-console-loader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · ChampHarbinger",
};

/**
 * Deliberately does NOT call buildAdminOverview() here. That was a database
 * call in the render path, which forced the Vercel frontend to hold
 * DATABASE_URL in the split deploy. The data is fetched client-side from
 * GET /api/admin/overview instead (see AdminConsoleLoader) — that route already
 * returned exactly this value, so only the transport changed.
 *
 * The gate below stays server-side and is unchanged: `requireSuperAdmin()`
 * reads SUPER_ADMIN_USER_IDS from the environment plus the Clerk session — no
 * database — so it is safe on a frontend. /api/admin/overview guards itself
 * with `requireSuperAdminApi()` as well, so authorisation never depends on this
 * check alone.
 */
export default async function AdminPage() {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/dashboard");
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminConsoleLoader />
    </div>
  );
}
