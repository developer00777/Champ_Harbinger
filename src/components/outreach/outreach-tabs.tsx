"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OutreachDraftsPanel,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";
import { SequenceList } from "@/components/outreach/sequence-list";
import { SignalKanban } from "@/components/outreach/signal-kanban";
import type { EnrollmentCard, SequenceRow } from "@/app/(app)/outreach/page";

interface OutreachTabsProps {
  drafts: DraftRow[];
  sequences: SequenceRow[];
  enrollments: EnrollmentCard[];
  onRefresh: () => void;
}

export function OutreachTabs({
  drafts,
  sequences,
  enrollments,
  onRefresh,
}: OutreachTabsProps) {
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null);
  const filteredEnrollments = selectedSequence
    ? enrollments.filter((e) => e.sequence_id === selectedSequence)
    : enrollments;

  return (
    <Tabs defaultValue="inbox" className="space-y-4">
      <TabsList className="border-border h-auto justify-start gap-0 rounded-none border-b bg-transparent p-0 text-muted-foreground">
        <TabsTrigger
          value="inbox"
          className="data-[active]:border-primary data-[active]:text-foreground -mb-px rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 font-medium text-muted-foreground shadow-none data-[active]:bg-transparent data-[active]:shadow-none"
        >
          Inbox
          {drafts.length > 0 && (
            <span className="text-muted-foreground ml-1 text-xs tabular-nums">
              {drafts.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="pipeline"
          className="data-[active]:border-primary data-[active]:text-foreground -mb-px rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 font-medium text-muted-foreground shadow-none data-[active]:bg-transparent data-[active]:shadow-none"
        >
          Pipeline
        </TabsTrigger>
        <TabsTrigger
          value="sequences"
          className="data-[active]:border-primary data-[active]:text-foreground -mb-px rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 font-medium text-muted-foreground shadow-none data-[active]:bg-transparent data-[active]:shadow-none"
        >
          Sequences
        </TabsTrigger>
      </TabsList>

      <TabsContent value="inbox">
        <OutreachDraftsPanel drafts={drafts} onRefresh={onRefresh} />
      </TabsContent>

      <TabsContent value="pipeline">
        <SignalKanban enrollments={filteredEnrollments} />
      </TabsContent>

      <TabsContent value="sequences">
        <SequenceList
          sequences={sequences}
          selectedId={selectedSequence}
          onSelect={(id) =>
            setSelectedSequence(id === selectedSequence ? null : id)
          }
        />
      </TabsContent>
    </Tabs>
  );
}
