import { currentUser } from "@clerk/nextjs/server";

import { DashboardShell } from "@/components/dashboard-shell";
import { MissingKeyBannerStack } from "@/components/missing-key-banner-stack";
import { ProvisionOnMount } from "@/components/provision-on-mount";
import { StreamingProvider } from "@/lib/streaming-context";
import { isSuperAdminId } from "@/lib/auth";

/**
 * Authenticated app layout — Clerk middleware (src/proxy.ts) gates this.
 * Wraps all authenticated pages in the sidebar + agent panel shell.
 *
 * Deliberately touches NO database. `currentUser()` is a Clerk API call and
 * `isSuperAdminId()` only reads SUPER_ADMIN_USER_IDS from the environment, so
 * this layout renders fine on a frontend that has no DATABASE_URL. First-login
 * team provisioning used to run here — it was the ONLY database call in the
 * render path — and now happens via <ProvisionOnMount />, which POSTs
 * /api/me/provision so the work lands on whichever origin owns the data.
 *
 * Keep it that way: a database call added here re-couples the frontend to
 * Postgres on every authed page render and breaks the split deploy.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const isSuperAdmin = isSuperAdminId(user?.id);

  return (
    <StreamingProvider>
      <ProvisionOnMount />
      <DashboardShell
        banner={<MissingKeyBannerStack />}
        isSuperAdmin={isSuperAdmin}
      >
        {children}
      </DashboardShell>
    </StreamingProvider>
  );
}
