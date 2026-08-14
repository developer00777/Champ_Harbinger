"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TogglePill } from "@/components/ui/toggle-pill";
import { EmailSkillCard } from "@/components/email-skills/email-skill-card";
import { EmailSkillDetailDialog } from "@/components/email-skills/email-skill-detail-dialog";
import { useAuthOrDev } from "@/lib/dev-auth-client";
import type { EmailSkill, EmailSkillScopeType } from "@/lib/types/email-skill";
import type { Campaign } from "@/lib/types/campaign";
import type { UserProfile } from "@/lib/types/profile";
import { profileDisplayName } from "@/lib/types/profile";

type ScopeFilter = "global" | "profile" | "campaign";

const SCOPE_OPTIONS: { label: string; value: ScopeFilter }[] = [
  { label: "Global default", value: "global" },
  { label: "Per profile", value: "profile" },
  { label: "Per campaign", value: "campaign" },
];

const SOURCE_FILTERS = [
  { label: "All", value: "all" },
  { label: "Built-in", value: "builtin" },
  { label: "Custom", value: "custom" },
] as const;

type SourceFilter = (typeof SOURCE_FILTERS)[number]["value"];

export default function EmailSkillsPage() {
  const { userId } = useAuthOrDev();
  const [skills, setSkills] = useState<EmailSkill[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  const [scope, setScope] = useState<ScopeFilter>("global");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());

  const [source, setSource] = useState<SourceFilter>("all");
  const [detailSkill, setDetailSkill] = useState<EmailSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const [skillsRes, campaignsRes, profilesRes] = await Promise.all([
      fetch("/api/email-skills").then((r) => r.json()),
      fetch("/api/campaigns").then((r) => r.json()),
      fetch("/api/profile").then((r) => r.json()),
    ]);

    if (!mountedRef.current) return;
    setSkills((skillsRes as EmailSkill[]) ?? []);
    setCampaigns((campaignsRes as Campaign[]) ?? []);
    setProfiles((profilesRes as UserProfile[]) ?? []);
    setLoading(false);
  }, []);

  const currentScopeId: string | null = (() => {
    if (scope === "global") return userId ?? null;
    if (scope === "profile") return selectedProfileId || null;
    return selectedCampaignId || null;
  })();

  const currentScopeType: EmailSkillScopeType = (
    scope === "global" ? "user" : scope
  ) as EmailSkillScopeType;

  const fetchAttachments = useCallback(
    async (scopeType: EmailSkillScopeType, scopeId: string | null) => {
      if (!scopeId) {
        setAttachedIds(new Set());
        return;
      }
      const params = new URLSearchParams({ scopeType, scopeId });
      const data = await fetch(`/api/email-skills/attachments?${params}`).then(
        (r) => r.json(),
      );
      if (!mountedRef.current) return;
      setAttachedIds(
        new Set((data as Array<{ skill_id: string }>).map((r) => r.skill_id)),
      );
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAttachments(currentScopeType, currentScopeId);
  }, [currentScopeType, currentScopeId, fetchAttachments]);

  const handleToggle = async (skillId: string, attached: boolean) => {
    if (!currentScopeId) {
      toast.error(
        scope === "profile"
          ? "Select a profile first."
          : "Select a campaign first.",
      );
      return;
    }
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (attached) next.add(skillId);
      else next.delete(skillId);
      return next;
    });

    if (attached) {
      const res = await fetch("/api/email-skills/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId,
          scopeType: currentScopeType,
          scopeId: currentScopeId,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to attach skill");
        setAttachedIds((prev) => {
          const next = new Set(prev);
          next.delete(skillId);
          return next;
        });
      }
    } else {
      const params = new URLSearchParams({
        skillId,
        scopeType: currentScopeType,
        scopeId: currentScopeId,
      });
      const res = await fetch(`/api/email-skills/attachments?${params}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Failed to detach skill");
        setAttachedIds((prev) => new Set(prev).add(skillId));
      }
    }
  };

  const handleSkillSaved = (updated: EmailSkill) => {
    setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setDetailSkill(updated);
  };

  const handleSkillDeleted = (skillId: string) => {
    setSkills((prev) => prev.filter((s) => s.id !== skillId));
    setDetailSkill(null);
  };

  const filtered = skills.filter((s) => {
    if (source === "builtin") return s.is_builtin;
    if (source === "custom") return !s.is_builtin;
    return true;
  });

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Email Skills</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const showToggle = currentScopeId !== null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Email Skills</h1>
            <p className="text-muted-foreground text-sm">
              Reusable rule packs that shape how the agent writes emails. Attach
              at the global, profile, or campaign scope.
            </p>
          </div>
          <CreateSkillButton
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(skill) => {
              setSkills((prev) => [skill, ...prev]);
              setDetailSkill(skill);
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Attach to
            </label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as ScopeFilter)}
              items={SCOPE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </div>
          {scope === "profile" && (
            <div className="w-64">
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Profile
              </label>
              <Select
                value={selectedProfileId}
                onValueChange={setSelectedProfileId}
                items={[
                  { value: "", label: "Select a profile…" },
                  ...profiles.map((p) => ({
                    value: p.id,
                    label: profileDisplayName(p),
                  })),
                ]}
              />
            </div>
          )}
          {scope === "campaign" && (
            <div className="w-64">
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Campaign
              </label>
              <Select
                value={selectedCampaignId}
                onValueChange={setSelectedCampaignId}
                items={[
                  { value: "", label: "Select a campaign…" },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-wrap gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <TogglePill
              key={f.value}
              active={source === f.value}
              onClick={() => setSource(f.value)}
            >
              {f.label}
            </TogglePill>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((skill) => (
            <EmailSkillCard
              key={skill.id}
              skill={skill}
              attached={attachedIds.has(skill.id)}
              showToggle={showToggle}
              onToggle={handleToggle}
              onClick={setDetailSkill}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground col-span-full py-8 text-center text-sm">
              No skills match this filter.
            </p>
          )}
        </div>
      </div>

      <EmailSkillDetailDialog
        skill={detailSkill}
        open={!!detailSkill}
        onOpenChange={(open) => {
          if (!open) setDetailSkill(null);
        }}
        onSaved={handleSkillSaved}
        onDeleted={handleSkillDeleted}
      />
    </div>
  );
}

function CreateSkillButton({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (skill: EmailSkill) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

  const reset = () => {
    setName("");
    setDescription("");
    setInstructions("");
  };

  const handleCreate = async () => {
    if (!name || !instructions) return;
    setSaving(true);
    const res = await fetch("/api/email-skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug: slugify(name) || `skill-${Date.now()}`,
        description: description || null,
        instructions,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error((err as { error?: string }).error ?? "Failed to create");
      return;
    }
    const data = (await res.json()) as EmailSkill;
    toast.success("Skill created");
    onCreated(data);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Skill
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[560px]">
        <DialogTitle>Create email skill</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Short & direct"
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary (optional)"
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Instructions
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={10}
              placeholder="Write imperative rules. Example: 'Never exceed 3 sentences. Open with the specific trigger signal.'"
              className="font-mono text-xs"
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleCreate}
            disabled={saving || !name || !instructions}
          >
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
