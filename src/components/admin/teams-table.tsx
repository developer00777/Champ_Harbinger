"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AdminTeamRow } from "@/lib/admin/overview";
import {
  fmtLimit,
  fmtUsd,
  spendRatio,
  spendToneClass,
} from "@/components/admin/format";
import { TeamDialog } from "@/components/admin/team-dialog";

export function TeamsTable({
  teams,
  onChanged,
}: {
  teams: AdminTeamRow[];
  onChanged: (msg?: string) => void;
}) {
  const [editing, setEditing] = useState<AdminTeamRow | null>(null);

  if (teams.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No teams yet. Create one to start grouping budgets.
      </p>
    );
  }

  return (
    <>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/50 border-b">
              <th className="px-4 py-2.5 text-left font-medium">Team</th>
              <th className="px-4 py-2.5 text-right font-medium">Members</th>
              <th className="px-4 py-2.5 text-right font-medium">Week spend</th>
              <th className="px-4 py-2.5 text-right font-medium">Limit</th>
              <th className="px-4 py-2.5 text-right font-medium">Per-user</th>
              <th className="px-4 py-2.5 text-center font-medium">Mode</th>
              <th className="px-4 py-2.5 text-center font-medium">Enabled</th>
              <th className="px-4 py-2.5 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const ratio = spendRatio(t.weekSpendUsd, t.weeklyLimitUsd);
              return (
                <tr
                  key={t.id}
                  className="border-border border-b last:border-b-0"
                >
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                    {t.memberCount}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium tabular-nums ${spendToneClass(ratio)}`}
                  >
                    {fmtUsd(t.weekSpendUsd)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                    {fmtLimit(t.weeklyLimitUsd)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                    {fmtLimit(t.perUserDefaultWeeklyLimitUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        t.hardStop
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {t.hardStop ? "hard" : "soft"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        t.enabled ? "bg-green-500" : "bg-muted-foreground/40"
                      }`}
                      title={t.enabled ? "Enabled" : "Disabled"}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TeamDialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        mode="edit"
        team={editing ?? undefined}
        onSaved={() => {
          setEditing(null);
          onChanged("Team updated");
        }}
      />
    </>
  );
}
