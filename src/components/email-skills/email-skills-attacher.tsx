"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmailSkillDetailDialog } from "@/components/email-skills/email-skill-detail-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import type { EmailSkill, EmailSkillScopeType } from "@/lib/types/email-skill";

interface EmailSkillsAttacherProps {
  scopeType: EmailSkillScopeType;
  scopeId: string | null;
  title?: string;
  description?: string;
  /** Message shown when scopeId is null. Differs between /settings (still
   *  resolving user id) and /profile (user hasn't saved the profile yet). */
  unscopedMessage?: string;
}

/**
 * Compact list of email skills with a toggle switch per skill. Used inside
 * settings (scope = user) and the profile editor (scope = profile). For the
 * richer, full-page management experience, users go to /email-skills.
 */
export function EmailSkillsAttacher({
  scopeType,
  scopeId,
  title = "Email skills",
  description = "Rules that shape how the agent writes emails.",
  unscopedMessage = "Loading…",
}: EmailSkillsAttacherProps) {
  const [skills, setSkills] = useState<EmailSkill[]>([]);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<EmailSkill | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const [skillsData, attachmentsData] = await Promise.all([
      fetch("/api/email-skills").then((r) => r.json()),
      scopeId
        ? fetch(
            `/api/email-skills/attachments?scopeType=${scopeType}&scopeId=${scopeId}`,
          ).then((r) => r.json())
        : Promise.resolve([] as Array<{ skill_id: string }>),
    ]);
    if (!mountedRef.current) return;
    setSkills(Array.isArray(skillsData) ? (skillsData as EmailSkill[]) : []);
    setAttachedIds(
      new Set(
        (Array.isArray(attachmentsData)
          ? (attachmentsData as Array<{ skill_id: string }>)
          : []
        ).map((r) => r.skill_id),
      ),
    );
    setLoading(false);
  }, [scopeType, scopeId]);

  useEffect(() => {
    mountedRef.current = true;

    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  const handleToggle = async (skillId: string, attached: boolean) => {
    if (!scopeId) {
      toast.error("No scope selected.");
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
          scopeType,
          scopeId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(`Failed: ${data.error ?? "Unknown error"}`);
        setAttachedIds((prev) => {
          const next = new Set(prev);
          next.delete(skillId);
          return next;
        });
      }
    } else {
      const res = await fetch(
        `/api/email-skills/attachments?skillId=${skillId}&scopeType=${scopeType}&scopeId=${scopeId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(`Failed: ${data.error ?? "Unknown error"}`);
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

  const attachedCount = attachedIds.size;

  const actions = (
    <>
      {scopeId && !loading && attachedCount > 0 && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
          {attachedCount} attached
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        nativeButton={false}
        render={<Link href="/email-skills" />}
      >
        Manage library
        <ArrowRight className="size-3.5" />
      </Button>
    </>
  );

  return (
    <>
      <SettingsSection
        title={title}
        description={description}
        actions={actions}
      >
        {loading ? (
          <div className="space-y-2">
            <div className="bg-muted/40 h-11 w-full animate-pulse rounded-md" />
            <div className="bg-muted/40 h-11 w-full animate-pulse rounded-md" />
            <div className="bg-muted/40 h-11 w-full animate-pulse rounded-md" />
          </div>
        ) : skills.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
            <Sparkles className="text-muted-foreground size-5" />
            <p className="text-sm font-medium">No skills yet</p>
            <p className="text-muted-foreground text-xs">
              Create your first email skill in the library.
            </p>
          </div>
        ) : !scopeId ? (
          <p className="text-muted-foreground text-sm">{unscopedMessage}</p>
        ) : (
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {skills.map((skill) => {
              const attached = attachedIds.has(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setDetailSkill(skill)}
                  className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          skill.is_builtin
                            ? "bg-blue-500/10 text-blue-500"
                            : "bg-emerald-500/10 text-emerald-500"
                        }`}
                      >
                        {skill.is_builtin ? "Built-in" : "Custom"}
                      </span>
                    </div>
                    {skill.description && (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    <Switch
                      checked={attached}
                      onCheckedChange={(checked) =>
                        handleToggle(skill.id, checked)
                      }
                      aria-label={
                        attached
                          ? `Detach ${skill.name}`
                          : `Attach ${skill.name}`
                      }
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <EmailSkillDetailDialog
        skill={detailSkill}
        open={!!detailSkill}
        onOpenChange={(open) => {
          if (!open) setDetailSkill(null);
        }}
        onSaved={handleSkillSaved}
        onDeleted={handleSkillDeleted}
      />
    </>
  );
}
