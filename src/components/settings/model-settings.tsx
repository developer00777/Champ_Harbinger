"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, type SelectItemDef } from "@/components/ui/select";
import { SettingsSection } from "@/components/settings/settings-section";

const ADMIN_DEFAULT = "__admin_default__";

interface ModelSettingsData {
  preferredModel: string | null;
  effectiveModel: string;
  effectiveSource: "user" | "admin" | "env";
  models: Array<{ id: string; label: string }>;
}

/**
 * Per-user AI model picker. "Use admin default" (the default) follows the
 * instance-wide model set by the super-admin (or the env default); picking a
 * concrete model overrides it for this user only.
 */
export function ModelSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ModelSettingsData | null>(null);
  const [selection, setSelection] = useState<string>(ADMIN_DEFAULT);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      try {
        const res = await fetch("/api/settings/model");
        if (!res.ok) return;
        const d: ModelSettingsData = await res.json();
        if (!mountedRef.current) return;
        setData(d);
        setSelection(d.preferredModel ?? ADMIN_DEFAULT);
      } catch {
        // silently fail; the section shows the loading fallback copy
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
      const res = await fetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredModel: selection === ADMIN_DEFAULT ? null : selection,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Failed to save model preference");
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              preferredModel: d.preferredModel,
              effectiveModel: d.effectiveModel,
              effectiveSource: d.preferredModel ? "user" : prev.effectiveSource,
            }
          : prev,
      );
      toast.success("Model preference saved");
    } catch {
      toast.error("Failed to save model preference");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="AI model"
        description="Choose which model powers your AI features."
      >
        <p className="text-muted-foreground text-sm">Loading model settings…</p>
      </SettingsSection>
    );
  }

  const models = data?.models ?? [];
  const items: SelectItemDef[] = [
    { value: ADMIN_DEFAULT, label: "Use admin default" },
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];
  // Preserve a saved preference that is no longer in the curated list.
  if (selection !== ADMIN_DEFAULT && !models.some((m) => m.id === selection)) {
    items.push({ value: selection, label: selection });
  }

  const sourceLabel =
    data?.effectiveSource === "user"
      ? "your preference"
      : data?.effectiveSource === "admin"
        ? "admin default"
        : "system default";

  return (
    <SettingsSection
      title="AI model"
      description="Choose which model powers your AI features. Leave on the admin default to follow the instance-wide setting."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="AI model"
            value={selection}
            onValueChange={setSelection}
            items={items}
            triggerClassName="w-72"
          />
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {data && (
          <p className="text-muted-foreground text-xs">
            Currently in effect:{" "}
            <span className="font-mono">{data.effectiveModel}</span> (
            {sourceLabel})
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
