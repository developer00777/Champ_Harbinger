"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings/settings-section";

export function EmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [providerName, setProviderName] = useState("stub");

  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        const res = await fetch("/api/settings/email");
        if (!res.ok) return;
        const data = await res.json();
        if (!mountedRef.current) return;

        setIsConfigured(data.is_configured);
        setProviderName(data.provider_name ?? "stub");
        setFromName(data.settings.from_name ?? "");
        setReplyTo(data.settings.reply_to_email ?? "");
      } catch {
        // silently fail
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_name: fromName || null,
          reply_to_email: replyTo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save settings");
        return;
      }
      toast.success("Email settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="Email"
        description="Configure outbound email settings. ChampMail integration coming soon."
      >
        <p className="text-muted-foreground text-sm">
          Loading email settings...
        </p>
      </SettingsSection>
    );
  }

  const statusBadge = isConfigured ? (
    <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
      Connected
    </span>
  ) : (
    <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
      {providerName === "stub" ? "Disabled (stub)" : "Not connected"}
    </span>
  );

  return (
    <SettingsSection
      title="Email"
      description="Configure outbound email settings. ChampMail integration coming soon."
      actions={statusBadge}
    >
      <div className="space-y-4">
        {!isConfigured && (
          <p className="text-muted-foreground text-sm rounded-md border border-dashed p-3">
            Email sending is currently disabled. ChampMail or another provider
            will be wired in a future release. You can still draft emails — they
            will not be sent until a provider is configured.
          </p>
        )}

        {/* From Name */}
        <div className="space-y-1.5">
          <label htmlFor="from-name" className="text-sm font-medium">
            From Name
          </label>
          <Input
            id="from-name"
            type="text"
            placeholder="e.g. Alex from ChampHarbinger"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Display name shown in the recipient&apos;s inbox.
          </p>
        </div>

        {/* Reply-To */}
        <div className="space-y-1.5">
          <label htmlFor="reply-to" className="text-sm font-medium">
            Reply-To Email (optional)
          </label>
          <Input
            id="reply-to"
            type="email"
            placeholder="e.g. alex@yourcompany.com"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Where replies go when a provider is configured.
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Email Settings"}
        </Button>
      </div>
    </SettingsSection>
  );
}
