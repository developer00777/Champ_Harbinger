"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectItemDef } from "@/components/ui/select";
import { SettingsSection } from "@/components/settings/settings-section";

const ENV_DEFAULT = "__env_default__";

interface AdminSettingsData {
  defaultModel: string | null;
  envDefaultModel: string;
  alertThresholds: number[];
  curatedModels: Array<{ id: string; label: string }>;
}

/**
 * Super-admin app settings: instance-wide default model (overrides the env
 * default; users can still pick their own) and usage-alert thresholds.
 */
export function AppSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AdminSettingsData | null>(null);
  const [model, setModel] = useState<string>(ENV_DEFAULT);
  const [thresholds, setThresholds] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const d: AdminSettingsData = await res.json();
        if (!mountedRef.current) return;
        setData(d);
        setModel(d.defaultModel ?? ENV_DEFAULT);
        setThresholds(
          d.alertThresholds.map((t) => Math.round(t * 100)).join(", "),
        );
      } catch {
        // section keeps its loading copy
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSave = async () => {
    const parsed = thresholds
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((s) => Number(s) / 100);
    if (parsed.some((n) => !Number.isFinite(n) || n <= 0 || n > 2)) {
      toast.error(
        "Thresholds must be percentages between 1 and 200 (e.g. 80, 100)",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultModel: model === ENV_DEFAULT ? null : model,
          ...(parsed.length > 0 ? { alertThresholds: parsed } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Failed to save settings");
        return;
      }
      toast.success("App settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="App settings"
        description="Instance-wide default model and usage alert thresholds."
      >
        <p className="text-muted-foreground text-sm">Loading app settings…</p>
      </SettingsSection>
    );
  }

  const models = data?.curatedModels ?? [];
  const items: SelectItemDef[] = [
    {
      value: ENV_DEFAULT,
      label: `Env default (${data?.envDefaultModel ?? "unset"})`,
    },
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];
  if (model !== ENV_DEFAULT && !models.some((m) => m.id === model)) {
    items.push({ value: model, label: model });
  }

  return (
    <SettingsSection
      title="App settings"
      description="Instance-wide default model (users may still pick their own) and usage alert thresholds."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="admin-default-model">
            Default AI model
          </label>
          <Select
            id="admin-default-model"
            aria-label="Default AI model"
            value={model}
            onValueChange={setModel}
            items={items}
            triggerClassName="w-80"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="alert-thresholds">
            Alert thresholds (% of cap)
          </label>
          <Input
            id="alert-thresholds"
            value={thresholds}
            onChange={(e) => setThresholds(e.target.value)}
            placeholder="80, 100"
            className="w-48"
          />
          <p className="text-muted-foreground text-xs">
            Comma-separated. An email goes to the admin when a member crosses
            each threshold of their daily or weekly cap.
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsSection>
  );
}
