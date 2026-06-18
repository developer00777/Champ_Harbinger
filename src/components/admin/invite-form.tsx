"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectItemDef } from "@/components/ui/select";

export function InviteForm({
  teamOptions,
  onInvited,
}: {
  teamOptions: SelectItemDef[];
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState(teamOptions[0]?.value ?? "");
  const [sending, setSending] = useState(false);

  async function handleInvite() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !teamId) {
      toast.error("Email and team are required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, teamId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Invite failed");
      }
      if (data?.clerkInviteSent) {
        toast.success(`Invitation sent to ${trimmed}`);
      } else {
        toast.success(`Member added: ${trimmed}`, {
          description: data?.note ?? "Clerk invitation was not sent.",
        });
      }
      setEmail("");
      onInvited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <label className="text-sm font-medium" htmlFor="invite-email">
          Email
        </label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleInvite();
          }}
        />
      </div>
      <div className="space-y-1 sm:w-56">
        <label className="text-sm font-medium" htmlFor="invite-team">
          Team
        </label>
        <Select
          id="invite-team"
          aria-label="Team"
          value={teamId}
          onValueChange={setTeamId}
          items={teamOptions}
          placeholder="Select a team"
        />
      </div>
      <Button onClick={handleInvite} disabled={sending}>
        <Send />
        {sending ? "Sending…" : "Invite"}
      </Button>
    </div>
  );
}
