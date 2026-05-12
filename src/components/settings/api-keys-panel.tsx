"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Circle, Edit2, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INTEGRATIONS,
  CATEGORY_LABELS,
  type Integration,
} from "@/lib/integrations";
import { formatRelative } from "@/components/ui/relative-time";
import { toast } from "sonner";

interface SavedKey {
  keyName: string;
  keyPrefix: string;
  keySuffix: string;
  updatedAt: string;
  configured: boolean;
}

export function ApiKeysPanel() {
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [showValue, setShowValue] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((data) => {
        setSavedKeys(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const keyableIntegrations = INTEGRATIONS.filter((i) => i.keyName);

  async function handleSave(integration: Integration) {
    const value = editing[integration.keyName!];
    if (!value?.trim()) return;
    setSaving((s) => ({ ...s, [integration.keyName!]: true }));
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyName: integration.keyName,
          keyValue: value.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const saved: SavedKey = await res.json();
      setSavedKeys((prev) => {
        const filtered = prev.filter((k) => k.keyName !== integration.keyName);
        return [...filtered, saved];
      });
      setEditing((e) => {
        const next = { ...e };
        delete next[integration.keyName!];
        return next;
      });
      toast.success(`${integration.name} key saved`);
    } catch {
      toast.error(`Failed to save ${integration.name} key`);
    } finally {
      setSaving((s) => ({ ...s, [integration.keyName!]: false }));
    }
  }

  async function handleRemove(keyName: string, integrationName: string) {
    try {
      await fetch(`/api/settings/keys/${keyName}`, { method: "DELETE" });
      setSavedKeys((prev) => prev.filter((k) => k.keyName !== keyName));
      toast.success(`${integrationName} key removed`);
    } catch {
      toast.error(`Failed to remove key`);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading keys…</div>;
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm mb-4">
        Keys saved here are encrypted and used only for your account. They
        override environment variables set on the server.
      </p>
      {keyableIntegrations.map((integration) => {
        const saved = savedKeys.find((k) => k.keyName === integration.keyName);
        const isEditing = integration.keyName! in editing;
        const isSaving = saving[integration.keyName!];

        return (
          <div
            key={integration.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{integration.name}</span>
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                  {CATEGORY_LABELS[integration.category]}
                </span>
                {saved ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle className="h-3 w-3" /> Saved
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Circle className="h-3 w-3" /> Not configured
                  </span>
                )}
              </div>
              {saved && !isEditing && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {saved.keyPrefix}
                  {"••••••••"}
                  {saved.keySuffix}
                  {" · "}
                  Updated {formatRelative(saved.updatedAt)}
                </p>
              )}
              {isEditing && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="relative flex-1">
                    <Input
                      type={
                        showValue[integration.keyName!] ? "text" : "password"
                      }
                      placeholder={`Paste your ${integration.name} key`}
                      value={editing[integration.keyName!]}
                      onChange={(e) =>
                        setEditing((prev) => ({
                          ...prev,
                          [integration.keyName!]: e.target.value,
                        }))
                      }
                      className="pr-9 font-mono text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setShowValue((s) => ({
                          ...s,
                          [integration.keyName!]: !s[integration.keyName!],
                        }))
                      }
                    >
                      {showValue[integration.keyName!] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    disabled={isSaving}
                    onClick={() => handleSave(integration)}
                  >
                    {isSaving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing((e) => {
                        const next = { ...e };
                        delete next[integration.keyName!];
                        return next;
                      })
                    }
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            {!isEditing && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setEditing((e) => ({
                      ...e,
                      [integration.keyName!]: "",
                    }))
                  }
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1" />
                  {saved ? "Update" : "Add"}
                </Button>
                {saved && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() =>
                      handleRemove(integration.keyName!, integration.name)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
