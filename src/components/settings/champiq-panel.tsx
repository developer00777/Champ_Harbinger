"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type HandoffMode = "auto" | "review" | "per_signal";

interface ChampIQSettings {
  champiq_url: string | null;
  handoff_mode: HandoffMode;
  signal_config: Record<string, { mode: "auto" | "review"; min_score: number }>;
  api_key_configured: boolean;
  api_key_prefix: string | null;
  api_key_suffix: string | null;
}

const HANDOFF_OPTIONS: Array<{
  value: HandoffMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Fully automatic",
    description:
      "Push qualified prospects to ChampIQ instantly. No review step.",
  },
  {
    value: "review",
    label: "Review queue",
    description:
      "Prospects land in the Dashboard queue. You approve each one before it goes to ChampIQ.",
  },
  {
    value: "per_signal",
    label: "Per-signal control",
    description:
      "Set Auto or Review individually per signal type in your signal settings.",
  },
];

export function ChampIQPanel() {
  const [settings, setSettings] = useState<ChampIQSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [champiqUrl, setChampiqUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/champiq/settings")
      .then((r) => r.json())
      .then((data: ChampIQSettings) => {
        setSettings(data);
        setChampiqUrl(data.champiq_url ?? "");
      })
      .catch(() => toast.error("Failed to load ChampIQ settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveUrl() {
    setSaving(true);
    try {
      await fetch("/api/champiq/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ champiq_url: champiqUrl }),
      });
      setSettings((prev) =>
        prev ? { ...prev, champiq_url: champiqUrl } : prev,
      );
      setConnectionOk(null);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!champiqUrl) return;
    setTesting(true);
    setConnectionOk(null);
    try {
      const res = await fetch("/api/champiq/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: champiqUrl }),
      });
      const data: { ok: boolean } = await res.json();
      setConnectionOk(data.ok);
      toast[data.ok ? "success" : "error"](
        data.ok ? "ChampIQ reachable" : "ChampIQ not reachable",
      );
    } catch {
      setConnectionOk(false);
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleGenerateKey() {
    setGeneratingKey(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/champiq/api-key", { method: "POST" });
      const data: { token: string; keyPrefix: string; keySuffix: string } =
        await res.json();
      setNewToken(data.token);
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              api_key_configured: true,
              api_key_prefix: data.keyPrefix,
              api_key_suffix: data.keySuffix,
            }
          : prev,
      );
      toast.success("API key generated — copy it now, it won't be shown again");
    } catch {
      toast.error("Failed to generate API key");
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRevokeKey() {
    await fetch("/api/champiq/api-key", { method: "DELETE" });
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            api_key_configured: false,
            api_key_prefix: null,
            api_key_suffix: null,
          }
        : prev,
    );
    setNewToken(null);
    toast.success("API key revoked");
  }

  async function handleModeChange(mode: HandoffMode) {
    try {
      await fetch("/api/champiq/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoff_mode: mode }),
      });
      setSettings((prev) => (prev ? { ...prev, handoff_mode: mode } : prev));
      toast.success("Handoff mode updated");
    } catch {
      toast.error("Failed to update handoff mode");
    }
  }

  function copyToken() {
    if (!newToken) return;
    void navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Connection URL */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">ChampIQ URL</p>
          <p className="text-muted-foreground text-xs">
            Base URL of your ChampIQ instance (e.g. http://localhost:5173)
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={champiqUrl}
            onChange={(e) => {
              setChampiqUrl(e.target.value);
              setConnectionOk(null);
            }}
            placeholder="http://localhost:5173"
            className="font-mono text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!champiqUrl || testing}
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Test"
            )}
          </Button>
          <Button size="sm" onClick={handleSaveUrl} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {connectionOk === true && (
          <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" /> ChampIQ reachable
          </p>
        )}
        {connectionOk === false && (
          <p className="text-destructive text-xs">
            ChampIQ not reachable — check the URL and that ChampIQ is running
          </p>
        )}
      </div>

      {/* API key */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">ChampHarbinger API key</p>
          <p className="text-muted-foreground text-xs">
            Paste this into ChampIQ → Settings → Connected tools →
            ChampHarbinger
          </p>
        </div>
        {settings?.api_key_configured && !newToken && (
          <p className="text-muted-foreground font-mono text-xs">
            {settings.api_key_prefix}••••••••{settings.api_key_suffix}
          </p>
        )}
        {newToken && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">
              {newToken}
            </code>
            <Button size="sm" variant="ghost" onClick={copyToken}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateKey}
            disabled={generatingKey}
          >
            {generatingKey ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {settings?.api_key_configured ? "Rotate key" : "Generate key"}
          </Button>
          {settings?.api_key_configured && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleRevokeKey}
            >
              Revoke
            </Button>
          )}
        </div>
      </div>

      {/* Handoff mode */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Handoff mode</p>
          <p className="text-muted-foreground text-xs">
            Controls when qualified prospects are sent to ChampIQ
          </p>
        </div>
        <div className="space-y-2">
          {HANDOFF_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
            >
              <input
                type="radio"
                name="handoff_mode"
                value={opt.value}
                checked={settings?.handoff_mode === opt.value}
                onChange={() => handleModeChange(opt.value)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-muted-foreground text-xs">
                  {opt.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Active connection indicator */}
      {settings?.champiq_url && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
          <Zap className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs text-green-700 dark:text-green-400">
            ChampHarbinger will serve as the signal engine for ChampIQ at{" "}
            <span className="font-mono">{settings.champiq_url}</span>
          </span>
        </div>
      )}
    </div>
  );
}
