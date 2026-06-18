"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminMemberRow } from "@/lib/admin/overview";
import {
  fmtLimit,
  fmtUsd,
  spendRatio,
  spendToneClass,
} from "@/components/admin/format";

const STATUS_TONE: Record<string, string> = {
  active: "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  invited: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  disabled: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function parseLimit(v: string): number | null | undefined {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function MembersTable({
  members,
  onChanged,
}: {
  members: AdminMemberRow[];
  onChanged: (msg?: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patchMember(
    id: string,
    body: Record<string, unknown>,
    successMsg: string,
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Request failed");
      }
      setEditingId(null);
      onChanged(successMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setBusyId(null);
    }
  }

  function saveOverride(m: AdminMemberRow) {
    const parsed = parseLimit(draft);
    if (parsed === undefined) {
      toast.error("Limit must be a non-negative number (or blank to clear)");
      return;
    }
    patchMember(m.id, { perUserWeeklyLimitUsd: parsed }, "Override saved");
  }

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No members yet. Invite a user above.
      </p>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th className="px-4 py-2.5 text-left font-medium">Email</th>
            <th className="px-4 py-2.5 text-left font-medium">Team</th>
            <th className="px-4 py-2.5 text-right font-medium">Week spend</th>
            <th className="px-4 py-2.5 text-right font-medium">
              Effective limit
            </th>
            <th className="px-4 py-2.5 text-left font-medium">Override</th>
            <th className="px-4 py-2.5 text-center font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const ratio = spendRatio(m.weekSpendUsd, m.effectiveLimitUsd);
            const isEditing = editingId === m.id;
            const busy = busyId === m.id;
            return (
              <tr key={m.id} className="border-border border-b last:border-b-0">
                <td className="px-4 py-2.5 font-medium">{m.email}</td>
                <td className="text-muted-foreground px-4 py-2.5">
                  {m.teamName}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${spendToneClass(ratio)}`}
                >
                  {fmtUsd(m.weekSpendUsd)}
                </td>
                <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                  {fmtLimit(m.effectiveLimitUsd)}
                </td>
                <td className="px-4 py-2.5">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        inputMode="decimal"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="(team default)"
                        className="h-7 w-28"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveOverride(m);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Save override"
                        disabled={busy}
                        onClick={() => saveOverride(m)}
                      >
                        <Check />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Cancel"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 tabular-nums"
                      onClick={() => {
                        setEditingId(m.id);
                        setDraft(
                          m.perUserWeeklyLimitUsd == null
                            ? ""
                            : String(m.perUserWeeklyLimitUsd),
                        );
                      }}
                    >
                      {m.perUserWeeklyLimitUsd == null
                        ? "—"
                        : fmtUsd(m.perUserWeeklyLimitUsd)}
                      <Pencil className="h-3 w-3 opacity-60" />
                    </button>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      STATUS_TONE[m.status] ?? STATUS_TONE.disabled
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {m.status === "disabled" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        patchMember(m.id, { status: "active" }, "Member enabled")
                      }
                    >
                      Enable
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        patchMember(
                          m.id,
                          { status: "disabled" },
                          "Member disabled",
                        )
                      }
                    >
                      Disable
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
