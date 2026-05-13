"use client";

import { useEffect, useRef, useState } from "react";
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

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

function NewCampaignDialog({
  onCreated,
}: {
  onCreated: (campaign: CampaignRow) => void;
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
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New campaign
          </Button>
        }
      />
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
            <p className="text-muted-foreground text-sm">
              All campaigns in your workspace. Click a name to open it; delete
              ones you no longer need.
            </p>
          </div>
          <NewCampaignDialog
            onCreated={(c) => setCampaigns((prev) => [c, ...prev])}
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="text-muted-foreground text-xs">
              Create your first campaign to start discovering prospects.
            </p>
            <NewCampaignDialog
              onCreated={(c) => setCampaigns((prev) => [c, ...prev])}
            />
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="border-border border-b last:border-b-0"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2"
                      >
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 capitalize">
                      {campaign.status}
                    </td>
                    <td className="px-4 py-2.5">
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
