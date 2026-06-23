"use client";

import { cn } from "@/lib/utils";
import type { SequenceRow } from "@/app/(app)/outreach/page";
import { ReviewButton } from "@/components/outreach/review-button";

interface SequenceListProps {
  sequences: SequenceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Mono status pill — active=green, paused/completed=muted, draft=primary.
function sequenceStatusPillClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "draft":
      return "bg-primary/10 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const METRIC_TILES: { key: keyof SequenceRow; label: string }[] = [
  { key: "enrolled", label: "Enrolled" },
  { key: "waiting", label: "Waiting" },
  { key: "sent", label: "Sent" },
  { key: "replied", label: "Replied" },
];

export function SequenceList({
  sequences,
  selectedId,
  onSelect,
}: SequenceListProps) {
  if (sequences.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Sequences</h2>
        <p className="text-muted-foreground text-sm">
          No sequences yet. Ask the AI to set up outreach for a campaign.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {sequences.map((seq) => (
        <div
          key={seq.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(seq.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(seq.id);
            }
          }}
          className={cn(
            "bg-card shadow-card cursor-pointer rounded-xl border p-4 transition-colors",
            selectedId === seq.id
              ? "border-primary"
              : "border-border hover:border-primary/40",
          )}
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{seq.name}</div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                {seq.campaign_name}
              </div>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-xs",
                sequenceStatusPillClass(seq.status),
              )}
            >
              {seq.status}
            </span>
            {seq.status === "draft" && (
              <div onClick={(e) => e.stopPropagation()}>
                <ReviewButton sequenceId={seq.id} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {METRIC_TILES.map((tile) => (
              <div key={tile.key} className="bg-muted rounded-lg p-3">
                <div className="eyebrow mb-1">{tile.label}</div>
                <div className="text-2xl font-bold tabular-nums">
                  {seq[tile.key]}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
