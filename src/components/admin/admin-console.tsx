"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import type { AdminOverview } from "@/lib/admin/overview";
import { GlobalHeader } from "@/components/admin/global-header";
import { TeamsTable } from "@/components/admin/teams-table";
import { MembersTable } from "@/components/admin/members-table";
import { InviteForm } from "@/components/admin/invite-form";
import { TeamDialog } from "@/components/admin/team-dialog";

export function AdminConsole({ initial }: { initial: AdminOverview }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    // router.refresh() resolves on the server round-trip; clear the spinner
    // shortly after so it reads as responsive without tracking RSC completion.
    setTimeout(() => setRefreshing(false), 600);
  }, [router]);

  const teamOptions = initial.teams.map((t) => ({
    value: t.id,
    label: t.name,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="text-muted-foreground text-sm">
            Monitor weekly spend and manage budget teams. Data stays per-user;
            teams are budget &amp; limit groups only.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <GlobalHeader global={initial.global} />

      <SettingsSection
        title="Teams"
        description="Budget groups. A team's week spend is the sum across its members."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New team
          </Button>
        }
      >
        <TeamsTable
          teams={initial.teams}
          onChanged={(msg) => {
            if (msg) toast.success(msg);
            refresh();
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Invite a user"
        description="Sends a Clerk invitation and provisions the team membership. The user is linked on first login by email."
      >
        {teamOptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Create a team first to invite users into it.
          </p>
        ) : (
          <InviteForm
            teamOptions={teamOptions}
            onInvited={() => refresh()}
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Members"
        description="Per-user week spend against the effective weekly cap (member override → team default)."
      >
        <MembersTable
          members={initial.members}
          onChanged={(msg) => {
            if (msg) toast.success(msg);
            refresh();
          }}
        />
      </SettingsSection>

      <TeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSaved={() => {
          toast.success("Team created");
          refresh();
        }}
      />
    </div>
  );
}
