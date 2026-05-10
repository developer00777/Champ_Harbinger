import { DashboardShell } from "@/components/dashboard-shell";
import { MissingKeyBannerStack } from "@/components/missing-key-banner-stack";
import { StreamingProvider } from "@/lib/streaming-context";

/**
 * Authenticated app layout — Clerk middleware (src/middleware.ts) gates this.
 * Wraps all authenticated pages in the sidebar + agent panel shell.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StreamingProvider>
      <DashboardShell banner={<MissingKeyBannerStack />}>
        {children}
      </DashboardShell>
    </StreamingProvider>
  );
}
