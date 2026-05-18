"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface QueueItem {
  id: string;
  company_name: string;
  company_domain: string;
  signal_name: string | null;
  signal_reasoning: string | null;
  score: number | null;
  talking_points: string[];
  created_at: string;
}

export function ChampIQQueueWidget() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/champiq/queue");
      if (res.ok) setItems(await res.json());
    } catch {
      // silently skip — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(id: string, action: "push" | "discard") {
    setActing((a) => ({ ...a, [id]: true }));
    try {
      const res = await fetch("/api/champiq/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        delivered?: boolean;
        error?: string;
        reason?: string;
      };

      if (action === "discard") {
        setItems((prev) => prev.filter((i) => i.id !== id));
        toast.success("Discarded");
        return;
      }

      // Push action: keep item in list if delivery failed
      if (body.delivered === false) {
        toast.error(
          `Marked as pushed but delivery failed: ${body.error ?? body.reason ?? "unknown"}`,
        );
      } else {
        setItems((prev) => prev.filter((i) => i.id !== id));
        toast.success("Delivered to ChampIQ");
      }
    } catch {
      toast.error("Action failed");
    } finally {
      setActing((a) => {
        const next = { ...a };
        delete next[id];
        return next;
      });
    }
  }

  async function pushAll() {
    setActing((a) => {
      const next = { ...a };
      for (const item of items) next[item.id] = true;
      return next;
    });
    try {
      const res = await fetch("/api/champiq/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push_all" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        total?: number;
        delivered?: number;
        failed?: number;
        champiq_url_configured?: boolean;
      };
      const total = body.total ?? items.length;
      const delivered = body.delivered ?? 0;
      const failed = body.failed ?? 0;
      if (!body.champiq_url_configured) {
        toast.error(
          `Marked ${total} as pushed, but ChampIQ URL is not configured — none were delivered`,
        );
        setItems([]);
      } else if (failed > 0) {
        toast.error(
          `${delivered}/${total} delivered to ChampIQ — ${failed} failed`,
        );
        await load();
      } else {
        toast.success(`Delivered ${delivered}/${total} to ChampIQ`);
        setItems([]);
      }
    } catch {
      toast.error("Push all failed");
    } finally {
      setActing({});
    }
  }

  // Don't render while loading or when queue is empty
  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">Ready for ChampIQ</span>
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={pushAll}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          Push all →
        </button>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-background flex items-center gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {item.company_name}
              </p>
              {item.signal_reasoning && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs italic">
                  &ldquo;{item.signal_reasoning}&rdquo;
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                disabled={acting[item.id]}
                onClick={() => act(item.id, "push")}
              >
                Push
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={acting[item.id]}
                onClick={() => act(item.id, "discard")}
                aria-label="Discard"
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
