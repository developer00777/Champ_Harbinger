"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";

import { profileDisplayName } from "@/lib/types/profile";
import type { UserProfile } from "@/lib/types/profile";

interface ProfileSelectorProps {
  campaignId: string;
  currentProfileId: string | null;
  onProfileChanged: (profileId: string | null) => void;
}

export function ProfileSelector({
  campaignId,
  currentProfileId,
  onProfileChanged,
}: ProfileSelectorProps) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        setProfiles(Array.isArray(data) ? (data as UserProfile[]) : []);
      } catch {
        // silently ignore load errors
      }
    };
    load();
  }, []);

  const handleChange = async (profileId: string) => {
    const value = profileId || null;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: value }),
      });
      if (!res.ok) {
        toast.error("Failed to update profile");
      } else {
        onProfileChanged(value);
      }
    } catch {
      toast.error("Failed to update profile");
    }
    setSaving(false);
  };

  if (profiles.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <User className="text-muted-foreground h-3.5 w-3.5" />
      <select
        value={currentProfileId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="border-input bg-background ring-offset-background focus:ring-ring h-7 rounded-md border px-2 text-xs focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
      >
        <option value="">No profile linked</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {profileDisplayName(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
