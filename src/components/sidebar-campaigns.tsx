"use client";

import { useEffect, useRef, useState } from "react";
import { SafeLink } from "@/components/safe-link";
import { Loader2 } from "lucide-react";
import {
  campaignStatusDotStyles,
  type CampaignStatus,
} from "@/lib/status-styles";

interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
  companyCount?: number;
  contactCount?: number;
}

interface SidebarCampaignsProps {
  activeCampaignId: string | null;
  onSelectCampaign: (id: string | null) => void;
}

/**
 * The "Campaigns" section of the left rail. Self-contained: fetches the user's
 * campaigns and polls every 10s so agent-created campaigns appear live. Plain
 * markup styled to the Aegis sidebar (mono eyebrow + dot-tagged rows).
 */
export function SidebarCampaigns({
  activeCampaignId,
  onSelectCampaign,
}: SidebarCampaignsProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchCampaigns = async () => {
      try {
        const res = await fetch("/api/campaigns");
        const data = await res.json();
        if (mountedRef.current) {
          if (Array.isArray(data)) {
            setCampaigns(
              data.map(
                (c: {
                  id: string;
                  name: string;
                  status: string;
                  createdAt: string;
                }) => ({
                  id: c.id,
                  name: c.name,
                  status: c.status,
                  created_at: c.createdAt,
                }),
              ),
            );
          }
          setLoading(false);
        }
      } catch {
        if (mountedRef.current) setLoading(false);
      }
    };

    // Initial fetch + periodic polling for agent-created campaigns
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="pt-3">
      <p className="eyebrow px-2.5 pb-2">Campaigns</p>

      {loading && (
        <div className="text-muted-foreground flex items-center gap-2 px-2.5 py-1.5 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && campaigns.length === 0 && (
        <SafeLink
          href="/chat"
          onClick={() => onSelectCampaign(null)}
          className="text-muted-foreground hover:text-foreground block px-2.5 py-1.5 text-xs transition-colors"
        >
          Speak to agent to get started
        </SafeLink>
      )}

      <div className="flex flex-col gap-0.5">
        {campaigns.map((campaign) => {
          const active = activeCampaignId === campaign.id;
          const dot =
            campaignStatusDotStyles[campaign.status as CampaignStatus] ||
            "bg-gray-400";
          return (
            <SafeLink
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              onClick={() => onSelectCampaign(campaign.id)}
              title={campaign.name}
              className={`flex h-[30px] items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] transition-colors ${
                active
                  ? "bg-peach text-primary font-medium"
                  : "text-foreground/80 hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span className="truncate">{campaign.name}</span>
            </SafeLink>
          );
        })}
      </div>
    </div>
  );
}
