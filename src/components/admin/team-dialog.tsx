"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminTeamRow } from "@/lib/admin/overview";

interface TeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  team?: AdminTeamRow;
  onSaved: () => void;
}

/** "" → null (unlimited), otherwise a parsed number. Returns undefined if invalid. */
function parseLimit(v: string): number | null | undefined {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function limitToInput(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

export function TeamDialog({
  open,
  onOpenChange,
  mode,
  team,
  onSaved,
}: TeamDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Remount the form per (team, open) so its state initializes straight
            from props — no setState-in-effect syncing. */}
        {open && (
          <TeamForm
            key={`${mode}:${team?.id ?? "new"}`}
            mode={mode}
            team={team}
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onOpenChange(false);
              onSaved();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TeamForm({
  mode,
  team,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  team?: AdminTeamRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [weeklyLimit, setWeeklyLimit] = useState(
    limitToInput(team?.weeklyLimitUsd),
  );
  const [perUserDefault, setPerUserDefault] = useState(
    limitToInput(team?.perUserDefaultWeeklyLimitUsd),
  );
  const [hardStop, setHardStop] = useState(team?.hardStop ?? true);
  const [enabled, setEnabled] = useState(team?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Team name is required");
      return;
    }
    const weekly = parseLimit(weeklyLimit);
    const perUser = parseLimit(perUserDefault);
    if (weekly === undefined || perUser === undefined) {
      toast.error(
        "Limits must be a non-negative number (or blank for unlimited)",
      );
      return;
    }

    setSaving(true);
    try {
      const url =
        mode === "create" ? "/api/admin/teams" : `/api/admin/teams/${team!.id}`;
      const body =
        mode === "create"
          ? {
              name: name.trim(),
              weeklyLimitUsd: weekly,
              perUserDefaultWeeklyLimitUsd: perUser,
              hardStop,
            }
          : {
              name: name.trim(),
              weeklyLimitUsd: weekly,
              perUserDefaultWeeklyLimitUsd: perUser,
              hardStop,
              enabled,
            };
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Request failed");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === "create" ? "New team" : `Edit ${team?.name ?? "team"}`}
        </DialogTitle>
        <DialogDescription>
          Budget group settings. Leave a limit blank for unlimited.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="team-name">
            Name
          </label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Growth team"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="team-weekly">
              Team weekly limit ($)
            </label>
            <Input
              id="team-weekly"
              inputMode="decimal"
              value={weeklyLimit}
              onChange={(e) => setWeeklyLimit(e.target.value)}
              placeholder="Unlimited"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="team-peruser">
              Per-user default ($)
            </label>
            <Input
              id="team-peruser"
              inputMode="decimal"
              value={perUserDefault}
              onChange={(e) => setPerUserDefault(e.target.value)}
              placeholder="Unlimited"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Hard stop</p>
            <p className="text-muted-foreground text-xs">
              Block paid work over the cap (off = warn only).
            </p>
          </div>
          <Switch
            checked={hardStop}
            onCheckedChange={setHardStop}
            aria-label="Hard stop"
          />
        </div>

        {mode === "edit" && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-muted-foreground text-xs">
                Disable to pause the team without deleting it.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enabled"
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create team" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
