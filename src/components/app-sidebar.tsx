"use client";

import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Eye,
  LayoutDashboard,
  Mail,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Target,
  UserCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { SafeLink } from "@/components/safe-link";
import { SidebarCampaigns } from "@/components/sidebar-campaigns";
import { useCampaign } from "@/lib/campaign-context";
import { useChampIQStatus } from "@/hooks/use-champiq-status";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Chat", url: "/chat", icon: MessageCircle },
  { title: "Campaigns", url: "/campaigns", icon: Target },
  { title: "Enrich", url: "/enrich", icon: Sparkles },
  { title: "Results", url: "/results", icon: ClipboardList },
  { title: "Sync queue", url: "/sync", icon: RefreshCw },
  { title: "Signals", url: "/signals", icon: Zap },
  { title: "Tracking", url: "/tracking", icon: Eye },
  { title: "Outreach", url: "/outreach", icon: Mail },
  { title: "Profiles", url: "/profile", icon: UserCircle },
];

function isActive(pathname: string | null, url: string): boolean {
  if (!pathname) return false;
  if (url === "/dashboard") return pathname === "/dashboard";
  return pathname === url || pathname.startsWith(`${url}/`);
}

/**
 * Fixed 220px left rail (Aegis). Icon nav with a peach active state, a mono
 * "Campaigns" section (the live campaign switcher), and a ChampIQ status
 * footer. Account / settings / admin live in the top-bar account menu.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { activeCampaignId, setActiveCampaignId } = useCampaign();
  const champiqStatus = useChampIQStatus();

  return (
    <aside className="bg-sidebar sticky top-[52px] hidden h-[calc(100dvh-52px)] w-[220px] shrink-0 flex-col border-r border-border md:flex">
      <nav className="flex flex-col gap-0.5 p-2.5">
        {navItems.map((item) => {
          const active = isActive(pathname, item.url);
          return (
            <SafeLink
              key={item.title}
              href={item.url}
              className={`flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors ${
                active
                  ? "bg-peach text-primary font-medium"
                  : "text-foreground/80 hover:bg-accent hover:text-foreground"
              }`}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.title}
            </SafeLink>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5">
        <SidebarCampaigns
          activeCampaignId={activeCampaignId}
          onSelectCampaign={setActiveCampaignId}
        />
      </div>

      <div className="border-t border-border p-2.5">
        {champiqStatus === "unconfigured" ? (
          <SafeLink
            href="/settings?tab=champiq"
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-1.5 py-1 text-xs transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            Connect ChampIQ
          </SafeLink>
        ) : (
          <div className="flex items-center gap-2 px-1.5 py-1">
            <span className="relative flex h-2 w-2">
              {champiqStatus === "connected" && (
                <span className="absolute inset-0 animate-ping rounded-full bg-green-500/60" />
              )}
              <span
                className={`relative h-2 w-2 rounded-full ${
                  champiqStatus === "connected"
                    ? "bg-green-500"
                    : "bg-muted-foreground/40"
                }`}
              />
            </span>
            <span className="text-muted-foreground text-xs">
              {champiqStatus === "connected" ? "ChampIQ live" : "ChampIQ"}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
