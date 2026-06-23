"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DraftRow } from "@/components/outreach/outreach-drafts-panel";

interface ReadyToSendHeroProps {
  drafts: DraftRow[];
  onRefresh: () => void;
}

export function ReadyToSendHero({ drafts, onRefresh }: ReadyToSendHeroProps) {
  const [sendingAll, setSendingAll] = useState(false);

  if (drafts.length === 0) {
    return (
      <section className="border-border bg-muted/20 rounded-xl border border-dashed px-6 py-8 text-center">
        <p className="text-sm font-medium">All clear</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Nothing is waiting on you right now.
        </p>
      </section>
    );
  }

  const sendAll = async () => {
    setSendingAll(true);
    try {
      const results = await Promise.allSettled(
        drafts.map((d) =>
          fetch("/api/outreach/send-now", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draftId: d.id }),
          }),
        ),
      );
      const failed = results.filter(
        (r) =>
          r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      ).length;
      if (failed === 0)
        toast.success(
          `Sent ${drafts.length} email${drafts.length === 1 ? "" : "s"}`,
        );
      else toast.error(`${failed} failed to send`);
      onRefresh();
    } finally {
      setSendingAll(false);
    }
  };

  return (
    <section className="bg-peach border-border flex items-center gap-4 rounded-2xl border p-5">
      <div className="bg-primary text-primary-foreground flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
        <Send className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold">
          {drafts.length} draft{drafts.length === 1 ? "" : "s"} ready to send
        </h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Approved and past the scheduled delay — each is personalized to a real
          signal.
        </p>
      </div>
      <Button onClick={sendAll} disabled={sendingAll} className="shrink-0">
        {sendingAll ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Send all
      </Button>
    </section>
  );
}
