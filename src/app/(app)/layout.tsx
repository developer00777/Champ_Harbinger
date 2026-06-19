import { currentUser } from "@clerk/nextjs/server";

import { DashboardShell } from "@/components/dashboard-shell";
import { MissingKeyBannerStack } from "@/components/missing-key-banner-stack";
import { StreamingProvider } from "@/lib/streaming-context";
import { ensureProvisioned } from "@/lib/teams";
import { isSuperAdminId } from "@/lib/auth";

/**
 * Authenticated app layout — Clerk middleware (src/middleware.ts) gates this.
 * Wraps all authenticated pages in the sidebar + agent panel shell.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // First-login provisioning: link a pending team invite (by email) to this
  // Clerk user. Idempotent + cheap (no-ops once linked).
  const user = await currentUser();
  if (user) {
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
    await ensureProvisioned(user.id, email);
  }

  const isSuperAdmin = isSuperAdminId(user?.id);

  return (
    <StreamingProvider>
      <DashboardShell
        banner={<MissingKeyBannerStack />}
        isSuperAdmin={isSuperAdmin}
      >
        {children}
      </DashboardShell>
    </StreamingProvider>
  );
}
