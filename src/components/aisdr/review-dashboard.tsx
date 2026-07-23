"use client";

/**
 * AISDR human review dashboard — a fast, keyboard-friendly list/detail view
 * over pending `emailDrafts` (GET/PATCH /api/aisdr/review).
 *
 * NOT wired into any nav/settings page — standalone component. Coordinator:
 * link this from a route such as /aisdr/review (mirrors the existing
 * /outreach/review pattern) and add the nav entry.
 *
 * Keyboard-first: j/k (or ↑/↓) move between drafts, a approves, e opens the
 * editor, r rejects, x toggles selection for batch approve, shift+a
 * batch-approves everything selected. Mouse works too, but nothing here
 * requires it for the common path — a click-through modal per draft would
 * make review the throughput bottleneck for the whole pipeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ReviewDraft {
  id: string;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  ai_reasoning: string | null;
  review_status: string;
  status: string;
  is_reply_draft: boolean;
  sequence_id: string | null;
  enrollment_id: string | null;
  person_id: string;
  person_name: string;
  person_title: string | null;
  campaign_id: string;
  campaign_name: string;
  created_at: string | null;
}

function htmlToPlain(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function plainToHtml(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

type EditState = { subject: string; bodyText: string };

export default function AisdrReviewDashboard() {
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Record<string, EditState>>({});
  const [editingActive, setEditingActive] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/aisdr/review");
      if (!res.ok) {
        toast.error("Failed to load review queue");
        return;
      }
      const data = (await res.json()) as { drafts: ReviewDraft[] };
      if (!mountedRef.current) return;
      setDrafts(data.drafts);
      setActiveIndex((prev) =>
        Math.min(prev, Math.max(0, data.drafts.length - 1)),
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const pending = useMemo(
    () => drafts.filter((d) => d.review_status === "pending"),
    [drafts],
  );

  const active = pending[activeIndex] ?? null;

  const startEdit = useCallback((draft: ReviewDraft) => {
    setEditing((prev) => ({
      ...prev,
      [draft.id]: {
        subject: draft.subject,
        bodyText: draft.body_text ?? htmlToPlain(draft.body_html),
      },
    }));
    setEditingActive(true);
  }, []);

  const setBusy = useCallback((ids: string[], busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const patch = useCallback(
    async (
      updates: Array<{
        id: string;
        action: "approve" | "reject";
        subject?: string;
        bodyHtml?: string;
        bodyText?: string;
        reason?: string;
      }>,
    ) => {
      const ids = updates.map((u) => u.id);
      setBusy(ids, true);
      try {
        const res = await fetch("/api/aisdr/review", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        if (!res.ok) {
          toast.error("Review action failed");
          return false;
        }
        const data = (await res.json()) as {
          results: Array<{ id: string; ok: boolean; sendError?: string }>;
        };
        const failed = data.results.filter((r) => !r.ok || r.sendError);
        if (failed.length > 0) {
          toast.error(
            `${failed.length} draft(s) had issues — check the review status`,
          );
        }
        setDrafts((prev) =>
          prev.map((d) =>
            ids.includes(d.id)
              ? {
                  ...d,
                  review_status:
                    updates.find((u) => u.id === d.id)?.action === "reject"
                      ? "rejected"
                      : "approved",
                }
              : d,
          ),
        );
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        return true;
      } finally {
        setBusy(ids, false);
      }
    },
    [setBusy],
  );

  const approveOne = useCallback(
    async (draft: ReviewDraft, edited?: EditState) => {
      await patch([
        {
          id: draft.id,
          action: "approve",
          ...(edited
            ? {
                subject: edited.subject,
                bodyHtml: plainToHtml(edited.bodyText),
                bodyText: edited.bodyText,
              }
            : {}),
        },
      ]);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[draft.id];
        return next;
      });
      setEditingActive(false);
    },
    [patch],
  );

  const rejectOne = useCallback(
    async (draft: ReviewDraft, reason?: string) => {
      await patch([{ id: draft.id, action: "reject", reason }]);
    },
    [patch],
  );

  const approveSelected = useCallback(async () => {
    if (selected.size === 0) return;
    await patch(
      [...selected].map((id) => ({ id, action: "approve" as const })),
    );
    toast.success(`Approved ${selected.size} draft(s)`);
  }, [patch, selected]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Keyboard shortcuts — the common review path never needs a mouse. ────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditableField =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);

      // Escape always works, even inside the editor.
      if (e.key === "Escape" && editingActive) {
        setEditingActive(false);
        return;
      }

      if (inEditableField) return;
      if (!active) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, pending.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "a":
          e.preventDefault();
          void approveOne(active);
          break;
        case "e":
          e.preventDefault();
          startEdit(active);
          break;
        case "r":
          e.preventDefault();
          void rejectOne(active);
          break;
        case "x":
          e.preventDefault();
          toggleSelected(active.id);
          break;
        case "A":
          if (e.shiftKey) {
            e.preventDefault();
            void approveSelected();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    pending.length,
    editingActive,
    approveOne,
    rejectOne,
    startEdit,
    toggleSelected,
    approveSelected,
  ]);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(pending.map((d) => d.id)));
  }, [pending]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">Loading review queue…</p>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <p className="text-lg font-medium">All caught up</p>
        <p className="text-muted-foreground text-sm">
          No pending drafts need review.
        </p>
      </div>
    );
  }

  const activeEdit = active ? editing[active.id] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">AISDR review queue</h1>
          <p className="text-muted-foreground text-xs">
            {pending.length} pending · {selected.size} selected · j/k move · a
            approve · e edit · r reject · x select · shift+A batch approve
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={selectAllVisible}>
            Select all
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearSelection}
            disabled={selected.size === 0}
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={approveSelected}
            disabled={selected.size === 0}
          >
            Approve {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          className="w-72 shrink-0 overflow-y-auto border-r"
          role="listbox"
          aria-label="Pending drafts"
        >
          {pending.map((d, i) => {
            const isActive = i === activeIndex;
            const isSelected = selected.has(d.id);
            const isBusy = busyIds.has(d.id);
            return (
              <button
                key={d.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => setActiveIndex(i)}
                disabled={isBusy}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm transition-colors",
                  isActive ? "bg-muted" : "hover:bg-muted/50",
                  isBusy && "opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-3.5 shrink-0"
                  checked={isSelected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(d.id)}
                  aria-label={`Select draft for ${d.person_name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {d.person_name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {d.subject}
                  </span>
                  {d.is_reply_draft && (
                    <span className="mt-0.5 inline-block rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      reply
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {active && (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <div>
                <p className="text-muted-foreground text-xs">
                  To: {active.to_email} · {active.campaign_name}
                </p>
                <h2 className="text-lg font-semibold">
                  {active.person_name}
                  {active.person_title ? ` — ${active.person_title}` : ""}
                </h2>
              </div>

              {active.ai_reasoning && (
                <div className="bg-muted rounded-md p-2 text-xs">
                  <span className="font-medium">AI reasoning: </span>
                  {active.ai_reasoning}
                </div>
              )}

              {activeEdit ? (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium">Subject</label>
                  <input
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
                    value={activeEdit.subject}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        [active.id]: {
                          ...prev[active.id],
                          subject: e.target.value,
                        },
                      }))
                    }
                  />
                  <label className="text-xs font-medium">Body</label>
                  <Textarea
                    rows={14}
                    value={activeEdit.bodyText}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        [active.id]: {
                          ...prev[active.id],
                          bodyText: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{active.subject}</p>
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    // Draft body is our own AI-composed content, already
                    // sanitized upstream by the composer's schema (plain
                    // <p>/<br>/<a>) — same rendering trust level as the
                    // existing /outreach/review page.
                    dangerouslySetInnerHTML={{ __html: active.body_html }}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                {activeEdit ? (
                  <>
                    <Button
                      onClick={() => approveOne(active, activeEdit)}
                      disabled={busyIds.has(active.id)}
                    >
                      Save &amp; approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing((prev) => {
                          const next = { ...prev };
                          delete next[active.id];
                          return next;
                        });
                        setEditingActive(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={() => approveOne(active)}
                      disabled={busyIds.has(active.id)}
                    >
                      Approve (a)
                    </Button>
                    <Button variant="outline" onClick={() => startEdit(active)}>
                      Edit (e)
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => rejectOne(active)}
                      disabled={busyIds.has(active.id)}
                    >
                      Reject (r)
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
