"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";

interface Connection {
  id: string;
  type: string;
  label: string | null;
  fromAddress: string;
  fromName: string | null;
  status: string;
  isDefault: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
}

const PRESETS = [
  { value: "gmail", label: "Gmail" },
  { value: "outlook", label: "Outlook / Office 365" },
  { value: "custom", label: "Other (custom SMTP/IMAP)" },
] as const;

const input =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm";

export function MailboxesPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<string>("gmail");
  const [form, setForm] = useState({
    fromAddress: "",
    fromName: "",
    password: "",
    smtpHost: "",
    smtpPort: "465",
    imapHost: "",
    imapPort: "993",
  });

  const load = () => {
    fetch("/api/mailboxes")
      .then((r) => r.json())
      .then((d) => setConnections(d.connections ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const connect = async () => {
    if (!form.fromAddress || !form.password) {
      toast.error("Email address and app password are required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        fromAddress: form.fromAddress,
        fromName: form.fromName || undefined,
        password: form.password,
      };
      if (preset === "custom") {
        Object.assign(body, {
          smtpHost: form.smtpHost,
          smtpPort: Number(form.smtpPort),
          smtpSecure: Number(form.smtpPort) === 465,
          imapHost: form.imapHost,
          imapPort: Number(form.imapPort),
          imapSecure: true,
        });
      } else {
        body.preset = preset;
      }
      const res = await fetch("/api/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not connect mailbox");
        return;
      }
      toast.success("Mailbox connected");
      setForm({ ...form, password: "" });
      load();
    } catch {
      toast.error("Could not connect mailbox");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/mailboxes/${id}`, { method: "DELETE" });
    load();
  };
  const setDefault = async (id: string) => {
    await fetch(`/api/mailboxes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    load();
  };

  return (
    <SettingsSection
      title="Mailboxes"
      description="Connect a mailbox to send outreach as yourself and sync replies. Gmail/Outlook need an app password (not your login password). One-click Google/Microsoft sign-in is coming next."
    >
      <div className="space-y-4">
        {!loading && connections.length > 0 && (
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {c.fromAddress}
                    {c.isDefault && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
                        default
                      </span>
                    )}
                    {c.status === "error" && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-600 dark:text-red-400">
                        error
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {c.label}
                    {c.lastSyncedAt
                      ? ` · synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                      : ""}
                    {c.lastError ? ` · ${c.lastError}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!c.isDefault && (
                    <button
                      onClick={() => setDefault(c.id)}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    onClick={() => remove(c.id)}
                    className="text-xs text-red-600 hover:underline dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-border space-y-3 rounded-lg border p-4">
          <div className="text-sm font-medium">Connect a mailbox</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Provider</span>
              <select
                className={input}
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Email address</span>
              <input
                className={input}
                type="email"
                placeholder="you@company.com"
                value={form.fromAddress}
                onChange={(e) =>
                  setForm({ ...form, fromAddress: e.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                From name (optional)
              </span>
              <input
                className={input}
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">App password</span>
              <input
                className={input}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            {preset === "custom" && (
              <>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">SMTP host</span>
                  <input
                    className={input}
                    placeholder="smtp.company.com"
                    value={form.smtpHost}
                    onChange={(e) =>
                      setForm({ ...form, smtpHost: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">SMTP port</span>
                  <input
                    className={input}
                    value={form.smtpPort}
                    onChange={(e) =>
                      setForm({ ...form, smtpPort: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">IMAP host</span>
                  <input
                    className={input}
                    placeholder="imap.company.com"
                    value={form.imapHost}
                    onChange={(e) =>
                      setForm({ ...form, imapHost: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">IMAP port</span>
                  <input
                    className={input}
                    value={form.imapPort}
                    onChange={(e) =>
                      setForm({ ...form, imapPort: e.target.value })
                    }
                  />
                </label>
              </>
            )}
          </div>
          {preset === "gmail" && (
            <p className="text-muted-foreground text-xs">
              Gmail: enable 2-Step Verification, then create an{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                app password
              </a>{" "}
              and paste it above.
            </p>
          )}
          <Button size="sm" onClick={connect} disabled={saving}>
            {saving ? "Connecting…" : "Connect & verify"}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
