"use client";

import { AgentPanel } from "@/components/agent-panel";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { CampaignProvider } from "@/lib/campaign-context";

/**
 * Authenticated app shell (Aegis). A full-width top bar sits above a row of
 * [sidebar · main · agent panel]. The campaign context wraps the whole tree so
 * the sidebar switcher, top-bar agent toggle, and agent panel stay in sync.
 */
export function DashboardShell({
  children,
  banner,
  isSuperAdmin = false,
}: {
  children: React.ReactNode;
  banner?: React.ReactNode;
  isSuperAdmin?: boolean;
}) {
  return (
    <CampaignProvider>
      <div data-app-shell="" className="flex h-dvh flex-col">
        <TopBar isSuperAdmin={isSuperAdmin} />
        {banner}
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
          <AgentPanel />
        </div>
      </div>
    </CampaignProvider>
  );
}
