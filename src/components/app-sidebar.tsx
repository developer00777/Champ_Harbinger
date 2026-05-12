"use client";

import { SafeLink } from "@/components/safe-link";

import {
  Eye,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MessageSquare,
  Settings,
  Target,
  UserCircle,
  Zap,
} from "lucide-react";

import { NavUser } from "@/components/nav-user";
import { SidebarCampaigns } from "@/components/sidebar-campaigns";
import { useCampaign } from "@/lib/campaign-context";
import { useChampIQStatus } from "@/hooks/use-champiq-status";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const navItems = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Chat",
    url: "/chat",
    icon: MessageCircle,
  },
  {
    title: "Campaigns",
    url: "/campaigns",
    icon: Target,
  },
  {
    title: "Signals",
    url: "/signals",
    icon: Zap,
  },
  {
    title: "Tracking",
    url: "/tracking",
    icon: Eye,
  },
  {
    title: "Outreach",
    url: "/outreach",
    icon: Mail,
  },
  {
    title: "Profiles",
    url: "/profile",
    icon: UserCircle,
  },
];

const defaultUser = {
  name: "",
  email: "",
  avatar: "",
};

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { activeCampaignId, setActiveCampaignId } = useCampaign();
  const champiqStatus = useChampIQStatus();

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<SafeLink href="/dashboard" />}
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">CH</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">ChampHarbinger</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={<SafeLink href={item.url} />}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarCampaigns
          activeCampaignId={activeCampaignId}
          onSelectCampaign={setActiveCampaignId}
        />
      </SidebarContent>
      <SidebarFooter>
        {champiqStatus === "connected" && (
          <div className="mx-2 mb-1 flex items-center gap-1.5 px-2 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="text-muted-foreground text-xs">ChampIQ live</span>
          </div>
        )}
        {champiqStatus === "unconfigured" && (
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<SafeLink href="/settings?tab=champiq" />}
              tooltip="Connect ChampIQ"
              className="text-muted-foreground"
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="text-xs">Connect ChampIQ</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<SafeLink href="/settings" />}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a href="mailto:hello@championsgroup.com?subject=ChampHarbinger%20feedback" />
              }
              tooltip="Feedback"
              aria-label="Give feedback"
            >
              <MessageSquare />
              <span>Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <NavUser user={defaultUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
