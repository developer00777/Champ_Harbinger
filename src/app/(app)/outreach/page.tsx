"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useChampIQStatus } from "@/hooks/use-champiq-status";
import { useCampaign } from "@/lib/campaign-context";
import { Button } from "@/components/ui/button";

import {
  classifyDraft,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";
import { ReadyToSendHero } from "@/components/outreach/ready-to-send-hero";
import { OutreachTabs } from "@/components/outreach/outreach-tabs";

export interface SequenceRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  enrolled: number;
  waiting: number;
  sent: number;
  replied: number;
}

export interface EnrollmentCard {
  id: string;
  sequence_id: string;
  person_id: string;
  campaign_people_id: string;
  current_step: number;
  status: string;
  next_send_at: string | null;
  person_name: string;
  person_title: string | null;
  company_name: string | null;
  outreach_status: string | null;
  sequence_name: string;
}

export default function OutreachPage() {
  const champiqStatus = useChampIQStatus();
  const { activeCampaignId, openAgentWith } = useCampaign();
  const [outreachMode, setOutreachMode] = useState<"champiq" | "standalone">(
    "champiq",
  );
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentCard[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/outreach");
    if (!mountedRef.current) return;
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as {
      sequences: SequenceRow[];
      enrollments: EnrollmentCard[];
      drafts: DraftRow[];
    };
    if (!mountedRef.current) return;
    setSequences(data.sequences);
    setEnrollments(data.enrollments);
    setDrafts(data.drafts);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Poll every 10s while the tab is visible — reflects approve/reject/cron progress
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      interval = setInterval(load, 10_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };

    if (document.visibilityState === "visible") start();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);

  const handleNewSequence = () => {
    const prompt = activeCampaignId
      ? `Create a 3-step outreach sequence for campaign ${activeCampaignId}. Ask me for the tone, the goal, and any specific talking points I want to include.`
      : "Create a 3-step outreach sequence. First ask me which campaign to use, then ask for the tone, the goal, and any specific talking points I want to include.";
    openAgentWith(prompt);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
            <p className="text-muted-foreground text-sm">
              Buying-signal-driven email sequences across all campaigns.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={handleNewSequence}>
              <Plus className="size-3.5" />
              New Sequence
            </Button>
            {champiqStatus === "connected" && (
              <div className="flex overflow-hidden rounded-md border text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setOutreachMode("champiq")}
                  className={`px-3 py-1.5 transition-colors ${
                    outreachMode === "champiq"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  ChampIQ
                </button>
                <button
                  type="button"
                  onClick={() => setOutreachMode("standalone")}
                  className={`px-3 py-1.5 transition-colors ${
                    outreachMode === "standalone"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Standalone
                </button>
              </div>
            )}
          </div>
        </div>

        {champiqStatus === "connected" && outreachMode === "champiq" ? (
          <div className="text-muted-foreground rounded-xl border bg-muted/20 p-4 text-sm">
            Outreach is being managed by ChampIQ. Visit your ChampIQ canvas to
            review sequences and track replies.{" "}
            <a href="/settings?tab=champiq" className="underline">
              Manage connection →
            </a>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : sequences.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No outreach sequences yet</p>
            <p className="text-muted-foreground text-xs">
              Create a sequence and the agent will help you design the steps,
              tone, and talking points.
            </p>
            <Button
              size="sm"
              className="mt-1 gap-1.5"
              onClick={handleNewSequence}
            >
              <Plus className="size-3.5" />
              New Sequence
            </Button>
          </div>
        ) : (
          <>
            <ReadyToSendHero
              drafts={drafts.filter((d) => classifyDraft(d) === "ready")}
              onRefresh={load}
            />

            <OutreachTabs
              drafts={drafts}
              sequences={sequences}
              enrollments={enrollments}
              onRefresh={load}
            />
          </>
        )}
      </div>
    </div>
  );
}
