"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { campaignStatusStyles, type CampaignStatus } from "@/lib/status-styles";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

function StatusPill({ status }: { status: string }) {
  const className =
    campaignStatusStyles[status as CampaignStatus]?.className ??
    campaignStatusStyles.paused.className;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-xs ${className}`}
    >
      {status}
    </span>
  );
}

function NewCampaignDialog({
  onCreated,
  trigger,
}: {
  onCreated: (campaign: CampaignRow) => void;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icp, setIcp] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          icp: icp.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(`Failed to create: ${body.error ?? "Unknown error"}`);
        return;
      }
      const campaign = (await res.json()) as CampaignRow;
      posthog.capture("campaign_created", { campaign_id: campaign.id });
      onCreated(campaign);
      setOpen(false);
      setName("");
      setIcp("");
      router.push(`/campaigns/${campaign.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Give your campaign a name and optionally describe your ideal
            customer profile.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="campaign-name"
              className="mb-1 block text-xs font-medium"
            >
              Campaign name <span className="text-destructive">*</span>
            </label>
            <Input
              id="campaign-name"
              placeholder="e.g. SaaS CTOs in Series A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) void handleCreate();
              }}
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="campaign-icp"
              className="mb-1 block text-xs font-medium"
            >
              ICP description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <Textarea
              id="campaign-icp"
              placeholder="e.g. Series A SaaS companies with 10-50 employees in the US"
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim()}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Stat strip card — mono eyebrow + big number + small sub (Aegis).
function StatCardItem({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: "default" | "orange" | "success";
}) {
  const valueClass =
    tone === "orange"
      ? "text-champions-orange"
      : tone === "success"
        ? "text-success"
        : "text-foreground";
  return (
    <div className="bg-card border-border shadow-card rounded-xl border p-4">
      <p className="eyebrow mb-2">{label}</p>
      <p
        className={`text-[28px] leading-none font-bold tracking-tight tabular-nums ${valueClass}`}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-1.5 text-xs">{sub}</p>
    </div>
  );
}

function formatCreated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CampaignsIndexPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchCampaigns = async () => {
      const res = await fetch("/api/campaigns");
      if (!res.ok) {
        if (mountedRef.current) setLoading(false);
        return;
      }
      const data = (await res.json()) as CampaignRow[];
      if (mountedRef.current) {
        setCampaigns(data ?? []);
        setLoading(false);
      }
    };

    void fetchCampaigns();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDelete = async (campaign: CampaignRow) => {
    setDeletingId(campaign.id);
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(`Failed to delete: ${body.error ?? "Unknown error"}`);
      setDeletingId(null);
      return;
    }

    posthog.capture("campaign_deleted", {
      campaign_id: campaign.id,
      campaign_status: campaign.status,
    });
    setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    toast.success(`Deleted "${campaign.name}"`);
    setDeletingId(null);
  };

  // Stat strip derived from the campaigns actually loaded — no invented metrics.
  const stats = useMemo(() => {
    const total = campaigns.length;
    const active = campaigns.filter((c) => c.status === "active").length;
    const paused = campaigns.filter((c) => c.status === "paused").length;
    const inProgress = campaigns.filter(
      (c) => c.status === "discovery" || c.status === "researching",
    ).length;
    return { total, active, paused, inProgress };
  }, [campaigns]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
            <p className="text-muted-foreground text-sm">
              All campaigns in your workspace. Click a name to open it; delete
              ones you no longer need.
            </p>
          </div>
          <NewCampaignDialog
            onCreated={(c) => setCampaigns((prev) => [c, ...prev])}
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="size-3.5" />
                New campaign
              </Button>
            }
          />
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCardItem
            label="Campaigns"
            value={stats.total}
            sub={`${stats.active} active`}
          />
          <StatCardItem
            label="Active"
            value={stats.active}
            sub="running now"
            tone="orange"
          />
          <StatCardItem
            label="In progress"
            value={stats.inProgress}
            sub="discovery & research"
          />
          <StatCardItem
            label="Paused"
            value={stats.paused}
            sub="on hold"
            tone="success"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-card border-border shadow-card space-y-2 rounded-xl border p-4">
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-card border-border shadow-card flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="text-muted-foreground text-xs">
              Create your first campaign to start discovering prospects.
            </p>
            <NewCampaignDialog
              onCreated={(c) => setCampaigns((prev) => [c, ...prev])}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Plus className="size-3.5" />
                  New campaign
                </Button>
              }
            />
          </div>
        ) : (
          <div className="bg-card border-border shadow-card overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted border-b">
                  <th className="eyebrow px-4 py-3 text-left">Name</th>
                  <th className="eyebrow px-4 py-3 text-left">Status</th>
                  <th className="eyebrow px-4 py-3 text-left">Created</th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="border-border hover:bg-muted/60 border-b transition-colors last:border-b-0"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="focus-visible:ring-ring rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill status={campaign.status} />
                    </td>
                    <td className="text-muted-foreground px-4 py-3.5 text-xs tabular-nums">
                      {formatCreated(campaign.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Delete campaign"
                              disabled={deletingId === campaign.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DialogContent>
                          <DialogTitle>Delete campaign</DialogTitle>
                          <DialogDescription>
                            This will permanently delete &quot;{campaign.name}
                            &quot; and all its companies and contacts. This
                            cannot be undone.
                          </DialogDescription>
                          <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>
                              Cancel
                            </DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => handleDelete(campaign)}
                              disabled={deletingId === campaign.id}
                            >
                              {deletingId === campaign.id
                                ? "Deleting..."
                                : "Delete Campaign"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
