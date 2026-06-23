"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ListRowsSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeleton-presets";
import { Textarea } from "@/components/ui/textarea";
import { EmailSkillsAttacher } from "@/components/email-skills/email-skills-attacher";
import { profileDisplayName } from "@/lib/types/profile";
import type { UserProfile, ProfileFormData } from "@/lib/types/profile";

const emptyForm: ProfileFormData = {
  label: "",
  name: "",
  email: "",
  role_title: "",
  company_name: "",
  company_url: "",
  personal_url: "",
  linkedin_url: "",
  twitter_url: "",
  offering_summary: "",
  notes: "",
};

// Initials for the rail avatar — derived from the profile's own name/label, no
// invented data. Falls back to a neutral glyph when there's nothing to use.
function profileInitials(p: UserProfile): string {
  const source = p.name?.trim() || p.label?.trim() || p.company_name?.trim();
  if (!source) return "··";
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return letters.toUpperCase() || "··";
}

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadFormFromProfile = (p: UserProfile) => {
    setForm({
      label: p.label ?? "",
      name: p.name ?? "",
      email: p.email ?? "",
      role_title: p.role_title ?? "",
      company_name: p.company_name ?? "",
      company_url: p.company_url ?? "",
      personal_url: p.personal_url ?? "",
      linkedin_url: p.linkedin_url ?? "",
      twitter_url: p.twitter_url ?? "",
      offering_summary: p.offering_summary ?? "",
      notes: p.notes ?? "",
    });
  };

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/profile");
      const list: UserProfile[] = res.ok
        ? ((await res.json()) as UserProfile[])
        : [];
      setProfiles(list);

      if (list.length > 0) {
        setSelectedId(list[0].id);
        loadFormFromProfile(list[0]);
      }
      setLoading(false);
    };
    void load();
  }, []);

  const selectProfile = (id: string) => {
    const p = profiles.find((pr) => pr.id === id);
    if (!p) return;
    setSelectedId(id);
    loadFormFromProfile(p);
  };

  const startNewProfile = () => {
    setSelectedId(null);
    setForm(emptyForm);
  };

  const update = (field: keyof ProfileFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);

    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]),
    );

    try {
      if (selectedId) {
        const res = await fetch(`/api/profile?id=${selectedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Failed to save");
        }
        const updated = (await res.json()) as UserProfile;
        setProfiles((prev) =>
          prev.map((p) => (p.id === selectedId ? updated : p)),
        );
        toast.success("Profile saved");
      } else {
        const res = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Failed to create");
        }
        const newProfile = (await res.json()) as UserProfile;
        setProfiles((prev) => [newProfile, ...prev]);
        setSelectedId(newProfile.id);
        toast.success("Profile created");
      }
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (profiles.length <= 1) {
      toast.error("You need at least one profile");
      return;
    }

    const res = await fetch(`/api/profile?id=${selectedId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(`Failed to delete: ${body.error ?? "Unknown error"}`);
      return;
    }

    const remaining = profiles.filter((p) => p.id !== selectedId);
    setProfiles(remaining);
    if (remaining.length > 0) {
      setSelectedId(remaining[0].id);
      loadFormFromProfile(remaining[0]);
    } else {
      setSelectedId(null);
      setForm(emptyForm);
    }
    toast.success("Profile deleted");
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
          <PageHeaderSkeleton />
          <ListRowsSkeleton count={4} />
        </div>
      </div>
    );
  }

  const canDelete = !!selectedId && profiles.length > 1;
  const headerLabel = selectedId
    ? form.label?.trim() || form.name?.trim() || "Profile"
    : "New profile";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 md:p-6 lg:px-8 lg:py-7">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Profiles</h1>
            <p className="text-muted-foreground text-sm">
              Create different profiles for different campaigns. Each profile is
              a seller identity with its own company, offering, and links.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={startNewProfile}
          >
            <Plus className="size-3.5" />
            New profile
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* Profiles rail */}
          <aside className="bg-card border-border shadow-card h-fit rounded-xl border p-3">
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <p className="eyebrow">Profiles</p>
              <span className="text-muted-foreground text-xs tabular-nums">
                {profiles.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {profiles.map((p) => {
                const active = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProfile(p.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-primary/60 bg-peach"
                        : "hover:border-primary/40 hover:bg-muted/60 border-transparent"
                    }`}
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {profileInitials(p)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm font-semibold ${
                          active ? "text-peach-foreground" : ""
                        }`}
                      >
                        {profileDisplayName(p)}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {p.company_name?.trim() ||
                          p.role_title?.trim() ||
                          p.email?.trim() ||
                          "No company"}
                      </span>
                    </span>
                  </button>
                );
              })}

              {profiles.length === 0 && (
                <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                  No profiles yet. Fill in the form to create your first.
                </p>
              )}
            </div>
          </aside>

          {/* Form panel */}
          <div className="space-y-6">
            <div className="bg-card border-border shadow-card rounded-xl border p-5 md:p-6">
              {/* Panel header */}
              <div className="flex items-start justify-between gap-4 pb-5">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold tracking-tight">
                    {headerLabel}
                  </h2>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Sender identity used by campaigns. Each profile carries its
                    own signature and offering summary.
                  </p>
                </div>
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground gap-1.5"
                    onClick={handleDelete}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                )}
              </div>

              {/* Profile label */}
              <div className="space-y-2">
                <label htmlFor="label" className="eyebrow block">
                  Profile label
                </label>
                <Input
                  id="label"
                  value={form.label ?? ""}
                  onChange={(e) => update("label", e.target.value)}
                  placeholder="e.g. SaaS Sales, Consulting, Agency Work"
                />
                <p className="text-muted-foreground text-xs">
                  A short name to identify this profile when linking it to
                  campaigns.
                </p>
              </div>

              {/* Personal info */}
              <div className="border-border mt-6 mb-4 border-b pb-2.5">
                <h3 className="text-base font-bold tracking-tight">
                  Personal info
                </h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium leading-none"
                  >
                    Name
                  </label>
                  <Input
                    id="name"
                    value={form.name ?? ""}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Your full name"
                    required
                    aria-required="true"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium leading-none"
                  >
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email ?? ""}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@company.com"
                    required
                    aria-required="true"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="role_title"
                    className="text-sm font-medium leading-none"
                  >
                    Role / Title
                  </label>
                  <Input
                    id="role_title"
                    value={form.role_title ?? ""}
                    onChange={(e) => update("role_title", e.target.value)}
                    placeholder="e.g. Founder & CEO"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="company_name"
                    className="text-sm font-medium leading-none"
                  >
                    Company Name
                  </label>
                  <Input
                    id="company_name"
                    value={form.company_name ?? ""}
                    onChange={(e) => update("company_name", e.target.value)}
                    placeholder="Your company"
                  />
                </div>
              </div>

              {/* Company links */}
              <div className="border-border mt-6 mb-4 border-b pb-2.5">
                <h3 className="text-base font-bold tracking-tight">Links</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="company_url"
                    className="text-sm font-medium leading-none"
                  >
                    Company Website
                  </label>
                  <Input
                    id="company_url"
                    type="url"
                    value={form.company_url ?? ""}
                    onChange={(e) => update("company_url", e.target.value)}
                    placeholder="https://yourcompany.com"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="personal_url"
                    className="text-sm font-medium leading-none"
                  >
                    Personal Website
                  </label>
                  <Input
                    id="personal_url"
                    type="url"
                    value={form.personal_url ?? ""}
                    onChange={(e) => update("personal_url", e.target.value)}
                    placeholder="https://yoursite.com"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="linkedin_url"
                    className="text-sm font-medium leading-none"
                  >
                    LinkedIn
                  </label>
                  <Input
                    id="linkedin_url"
                    type="url"
                    value={form.linkedin_url ?? ""}
                    onChange={(e) => update("linkedin_url", e.target.value)}
                    placeholder="https://linkedin.com/in/yourname"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="twitter_url"
                    className="text-sm font-medium leading-none"
                  >
                    X / Twitter
                  </label>
                  <Input
                    id="twitter_url"
                    type="url"
                    value={form.twitter_url ?? ""}
                    onChange={(e) => update("twitter_url", e.target.value)}
                    placeholder="https://x.com/yourhandle"
                  />
                </div>
              </div>

              {/* What you're selling */}
              <div className="border-border mt-6 mb-4 border-b pb-2.5">
                <h3 className="text-base font-bold tracking-tight">
                  What you&apos;re selling
                </h3>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="offering_summary"
                    className="text-sm font-medium leading-none"
                  >
                    Offering summary
                  </label>
                  <Textarea
                    id="offering_summary"
                    value={form.offering_summary ?? ""}
                    onChange={(e) => update("offering_summary", e.target.value)}
                    placeholder="Describe your product or service in a few sentences. What problem does it solve? Who is it for?"
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="notes"
                    className="text-sm font-medium leading-none"
                  >
                    Additional notes
                  </label>
                  <Textarea
                    id="notes"
                    value={form.notes ?? ""}
                    onChange={(e) => update("notes", e.target.value)}
                    placeholder="Anything else ChampHarbinger should know -- target market, differentiators, constraints, tone preferences, etc."
                    rows={4}
                  />
                </div>
              </div>

              <div className="border-border mt-6 flex justify-end border-t pt-5">
                <Button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    loading ||
                    !form.name?.trim() ||
                    !form.email?.trim()
                  }
                >
                  {saving
                    ? "Saving..."
                    : selectedId
                      ? "Save profile"
                      : "Create profile"}
                </Button>
              </div>
            </div>

            {/* Email skills for this profile */}
            <div className="bg-card border-border shadow-card rounded-xl border p-5 md:p-6">
              <EmailSkillsAttacher
                scopeType="profile"
                scopeId={selectedId}
                title="Email skills for this profile"
                description="Applied whenever a campaign uses this sender identity."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
