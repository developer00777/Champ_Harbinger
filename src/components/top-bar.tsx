"use client";

import { usePathname } from "next/navigation";
import { MessageCircle, X } from "lucide-react";

import { SafeLink } from "@/components/safe-link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";

// First path segment → section title shown in the top-bar breadcrumb.
const SECTION_TITLES: Record<string, string> = {
  dashboard: "Overview",
  chat: "Chat",
  campaigns: "Campaigns",
  signals: "Signals",
  tracking: "Tracking",
  outreach: "Outreach",
  profile: "Profiles",
  "email-skills": "Email skills",
  settings: "Settings",
  admin: "Admin",
};

function sectionTitle(pathname: string | null): string {
  const seg = pathname?.split("/").filter(Boolean)[0] ?? "dashboard";
  return SECTION_TITLES[seg] ?? "Overview";
}

/** Agent panel toggle — preserved from the old header, contextual to campaign. */
function AgentToggle() {
  const { activeCampaignId, agentOpen, setAgentOpen } = useCampaign();
  const pathname = usePathname();

  if (pathname?.startsWith("/chat")) return null;

  const label = activeCampaignId ? "Campaign Agent" : "Agent";

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAgentOpen(!agentOpen)}
        aria-pressed={agentOpen}
      >
        <MessageCircle className="mr-1.5 h-4 w-4" />
        {label}
      </Button>
      {agentOpen && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close agent panel"
          onClick={() => setAgentOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Full-width top bar (Aegis). Logo + wordmark + section breadcrumb on the left;
 * agent toggle, theme pill, and account menu on the right. Spans above the
 * sidebar + main row (see DashboardShell).
 */
export function TopBar({
  isSuperAdmin = false,
}: {
  readonly isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const title = sectionTitle(pathname);

  return (
    <header className="bg-card/80 sticky top-0 z-50 flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border px-4 backdrop-blur-md lg:px-[18px]">
      <SafeLink href="/dashboard" className="flex items-center gap-2.5">
        <span className="bg-primary text-primary-foreground flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold">
          CH
        </span>
        <span className="text-sm font-semibold">ChampHarbinger</span>
      </SafeLink>
      <span className="mx-1 h-[18px] w-px bg-border" />
      <span className="text-[13px] font-medium">{title}</span>

      <div className="ml-auto flex items-center gap-2">
        <AgentToggle />
        <ThemeSwitcher />
        <AccountMenu isSuperAdmin={isSuperAdmin} />
      </div>
    </header>
  );
}
