"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TogglePill } from "@/components/ui/toggle-pill";
import { SignalCard } from "@/components/signals/signal-card";
import { SignalDetailDialog } from "@/components/signals/signal-detail-dialog";
import { useCampaign } from "@/lib/campaign-context";
import type { Signal, SignalCategory } from "@/lib/types/signal";
import type { Campaign } from "@/lib/types/campaign";

const CATEGORIES: {
  label: string;
  value: SignalCategory | "all" | "community";
}[] = [
  { label: "All", value: "all" },
  { label: "Hiring", value: "hiring" },
  { label: "Funding", value: "funding" },
  { label: "Executive", value: "executive" },
  { label: "Product", value: "product" },
  { label: "Engagement", value: "engagement" },
  { label: "Custom", value: "custom" },
  { label: "Community", value: "community" },
];

const SIGNAL_CATEGORY_OPTIONS: { value: SignalCategory; label: string }[] = [
  { value: "hiring", label: "Hiring" },
  { value: "funding", label: "Funding" },
  { value: "executive", label: "Executive" },
  { value: "product", label: "Product" },
  { value: "engagement", label: "Engagement" },
  { value: "custom", label: "Custom" },
];

function NewSignalDialog({
  onCreated,
}: {
  onCreated: (signal: Signal) => void;
}) {
  const { openAgentWith } = useCampaign();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "quick">("choose");

  // Quick-create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SignalCategory>("custom");
  const [creating, setCreating] = useState(false);

  const resetForm = () => {
    setName("");
    setDescription("");
    setCategory("custom");
    setMode("choose");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetForm();
  };

  const handleCreateWithAI = () => {
    setOpen(false);
    resetForm();
    openAgentWith(
      "I want to create a new signal. Help me design it -- ask what I want to track, what the threshold should be, and then create it.",
    );
  };

  const handleQuickCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          executionType: "exa_search",
          config: description.trim() ? { query: description.trim() } : {},
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(
          `Failed to create signal: ${body.error ?? "Unknown error"}`,
        );
        return;
      }
      const raw = (await res.json()) as {
        id: string;
        name: string;
        slug: string;
        description: string;
        long_description: string | null;
        category: SignalCategory;
        icon: string | null;
        execution_type: string;
        tool_key: string | null;
        config: Record<string, unknown>;
        is_builtin: boolean;
        is_public: boolean;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      };
      const signal: Signal = {
        id: raw.id,
        name: raw.name,
        slug: raw.slug,
        description: raw.description,
        long_description: raw.long_description,
        category: raw.category,
        icon: raw.icon,
        execution_type: raw.execution_type as Signal["execution_type"],
        tool_key: raw.tool_key,
        config: raw.config,
        is_builtin: raw.is_builtin,
        is_public: raw.is_public,
        created_by: raw.created_by,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
      };
      toast.success(`Signal "${signal.name}" created`);
      onCreated(signal);
      setOpen(false);
      resetForm();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Signal
          </Button>
        }
      />
      <DialogContent>
        {mode === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>New signal</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-0.5 px-4 py-3 text-left"
                onClick={handleCreateWithAI}
              >
                <span className="font-medium">Create with AI</span>
                <span className="text-muted-foreground text-xs font-normal">
                  The agent walks you through signal design and creates it for
                  you.
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-0.5 px-4 py-3 text-left"
                onClick={() => setMode("quick")}
              >
                <span className="font-medium">Quick create</span>
                <span className="text-muted-foreground text-xs font-normal">
                  Define a simple exa_search signal with a name and search
                  query.
                </span>
              </Button>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Quick create signal</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div>
                <label
                  htmlFor="signal-name"
                  className="mb-1 block text-xs font-medium"
                >
                  Signal name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="signal-name"
                  placeholder="e.g. Hiring surge"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label
                  htmlFor="signal-description"
                  className="mb-1 block text-xs font-medium"
                >
                  What to look for{" "}
                  <span className="text-muted-foreground font-normal">
                    (becomes the search query)
                  </span>
                </label>
                <Textarea
                  id="signal-description"
                  placeholder="e.g. company is actively hiring senior engineers or DevOps roles"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <label
                  htmlFor="signal-category"
                  className="mb-1 block text-xs font-medium"
                >
                  Category
                </label>
                <Select
                  id="signal-category"
                  value={category}
                  onValueChange={(v) => setCategory(v as SignalCategory)}
                  items={SIGNAL_CATEGORY_OPTIONS}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode("choose")}>
                Back
              </Button>
              <Button
                onClick={() => void handleQuickCreate()}
                disabled={creating || !name.trim()}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SignalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      }
    >
      <SignalsPageContent />
    </Suspense>
  );
}

function SignalsPageContent() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get("campaign");
  const { openAgentWith, agentOpen } = useCampaign();

  const [signals, setSignals] = useState<Signal[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId ?? "",
  );
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [detailSignal, setDetailSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const [signalsRes, campaignsRes] = await Promise.all([
      fetch("/api/signals"),
      fetch("/api/campaigns"),
    ]);
    if (!mountedRef.current) return;
    if (signalsRes.ok) {
      setSignals((await signalsRes.json()) as Signal[]);
    }
    if (campaignsRes.ok) {
      const rawCampaigns = (await campaignsRes.json()) as Array<{
        id: string;
        name: string;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
      // Map camelCase API response to the Campaign type used by the component
      setCampaigns(
        rawCampaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          profile_id: null,
          icp: {},
          offering: {},
          positioning: {},
          search_criteria: {},
          notes: null,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        })),
      );
    }
    setLoading(false);
  }, []);

  const fetchToggles = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setEnabledMap({});
      return;
    }
    const res = await fetch(
      `/api/campaign-signals?campaignId=${encodeURIComponent(campaignId)}`,
    );
    if (!mountedRef.current) return;
    if (!res.ok) return;
    const data = (await res.json()) as Array<{
      signalId: string;
      enabled: boolean;
    }>;
    const map: Record<string, boolean> = {};
    for (const row of data) {
      map[row.signalId] = row.enabled;
    }
    setEnabledMap(map);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedCampaignId) void fetchToggles(selectedCampaignId);
    else setEnabledMap({});
  }, [selectedCampaignId, fetchToggles]);

  const handleToggle = async (signalId: string, enabled: boolean) => {
    if (!selectedCampaignId) return;
    setEnabledMap((prev) => ({ ...prev, [signalId]: enabled }));
    const res = await fetch("/api/campaign-signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: selectedCampaignId,
        signal_id: signalId,
        enabled,
      }),
    });
    if (!res.ok) {
      toast.error("Failed to toggle signal");
      setEnabledMap((prev) => ({ ...prev, [signalId]: !enabled }));
    }
  };

  const handleEdit = (signal: Signal) => {
    setDetailSignal(null);
    openAgentWith(
      `I want to edit the "${signal.name}" signal (id: ${signal.id}). Ask me what I'd like to change, then call updateSignal with the changes. Current config:\n\n\`\`\`json\n${JSON.stringify(
        {
          name: signal.name,
          description: signal.description,
          long_description: signal.long_description,
          category: signal.category,
          icon: signal.icon,
          execution_type: signal.execution_type,
          tool_key: signal.tool_key,
          config: signal.config,
        },
        null,
        2,
      )}\n\`\`\``,
    );
  };

  const handleMakePublic = async (signal: Signal) => {
    const res = await fetch("/api/signals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: signal.id, is_public: true }),
    });
    if (!res.ok) {
      toast.error("Failed to publish signal");
    } else {
      toast.success("Signal published to community");
      setSignals((prev) =>
        prev.map((s) => (s.id === signal.id ? { ...s, is_public: true } : s)),
      );
      setDetailSignal((prev) =>
        prev?.id === signal.id ? { ...prev, is_public: true } : prev,
      );
    }
  };

  const filtered = signals.filter((s) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "community") return s.is_public && !s.is_builtin;
    return s.category === activeCategory;
  });

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
            <p className="text-muted-foreground text-sm">
              Browse and manage buying signals. Signals guide the agent on what
              to research for each prospect.
            </p>
          </div>
          <NewSignalDialog
            onCreated={(signal) => setSignals((prev) => [signal, ...prev])}
          />
        </div>

        {/* Campaign selector */}
        <div className="max-w-xs">
          <label
            htmlFor="campaign-select"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            Campaign
          </label>
          <Select
            id="campaign-select"
            value={selectedCampaignId}
            onValueChange={setSelectedCampaignId}
            items={[
              { value: "", label: "No campaign (browse only)" },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        <Separator />

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <TogglePill
              key={cat.value}
              active={activeCategory === cat.value}
              onClick={() => setActiveCategory(cat.value)}
            >
              {cat.label}
            </TogglePill>
          ))}
        </div>

        {/* Signal cards grid / list */}
        <div
          key={agentOpen ? "narrow" : "wide"}
          className={
            agentOpen
              ? "animate-in fade-in-0 duration-200 grid gap-4 grid-cols-1"
              : "animate-in fade-in-0 duration-200 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {filtered.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              variant="card"
              enabled={enabledMap[signal.id] ?? false}
              showToggle={!!selectedCampaignId}
              onToggle={handleToggle}
              onClick={setDetailSignal}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground col-span-full py-8 text-center text-sm">
              No signals in this category.
            </p>
          )}
        </div>
      </div>

      <SignalDetailDialog
        signal={detailSignal}
        open={!!detailSignal}
        onOpenChange={(open) => {
          if (!open) setDetailSignal(null);
        }}
        onMakePublic={handleMakePublic}
        onEdit={handleEdit}
      />
    </div>
  );
}
