"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";

interface DomainSearchResult {
  domain: string;
  available: boolean;
  priceUsd?: number;
}

interface DomainStatus {
  domain: string;
  status: string;
  spfVerified?: boolean;
  dkimVerified?: boolean;
  dmarcVerified?: boolean;
  healthy: boolean;
}

interface MailboxStatus {
  email: string;
  status: string;
}

interface InfraOrder {
  id: string;
  providerOrderId: string | null;
  status: string;
  request: { domain?: string; mailboxCount?: number };
  createdAt: string;
}

const input =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm";

function HealthBadge({
  healthy,
  status,
}: {
  healthy: boolean;
  status: string;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
        healthy
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {healthy ? "healthy" : status || "pending"}
    </span>
  );
}

/**
 * InboxKit settings panel — domain search + order placement, plus a read
 * view of owned domains/mailboxes and recent orders. Standalone component;
 * the coordinator wires this into the settings page.
 */
export function InboxKitPanel() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DomainSearchResult[]>([]);

  const [domains, setDomains] = useState<DomainStatus[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxStatus[]>([]);
  const [orders, setOrders] = useState<InfraOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);

  const [orderDomain, setOrderDomain] = useState<string | null>(null);
  const [mailboxCount, setMailboxCount] = useState("3");
  const [placingOrder, setPlacingOrder] = useState(false);

  const load = () => {
    Promise.all([
      fetch("/api/infra/domains").then((r) => r.json()),
      fetch("/api/infra/mailboxes").then((r) => r.json()),
      fetch("/api/infra/orders").then((r) => r.json()),
    ])
      .then(([d, m, o]) => {
        if (d.error) setNotConfigured(true);
        setDomains(d.domains ?? []);
        setMailboxes(m.mailboxes ?? []);
        setOrders(o.orders ?? []);
      })
      .catch(() => setNotConfigured(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/infra/domains/search?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Domain search failed");
        setNotConfigured(res.status === 501);
        return;
      }
      setResults(data.results ?? []);
    } catch {
      toast.error("Domain search failed");
    } finally {
      setSearching(false);
    }
  };

  const placeOrder = async () => {
    if (!orderDomain) return;
    const count = Number(mailboxCount);
    if (!count || count < 1) {
      toast.error("Mailbox count must be at least 1");
      return;
    }
    setPlacingOrder(true);
    try {
      const res = await fetch("/api/infra/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: orderDomain, mailboxCount: count }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to place order");
        return;
      }
      toast.success(
        `Order placed for ${orderDomain} — provisioning ${count} mailbox(es)`,
      );
      setOrderDomain(null);
      setResults([]);
      setQuery("");
      load();
    } catch {
      toast.error("Failed to place order");
    } finally {
      setPlacingOrder(false);
    }
  };

  return (
    <SettingsSection
      title="InboxKit — email infrastructure"
      description="Buy dedicated cold-outreach domains and mailboxes, provisioned with SPF/DKIM/DMARC already configured. Mailboxes become usable for sequencing automatically once InboxKit reports them ready."
    >
      {notConfigured && !loading && (
        <div className="border-border bg-muted/30 mb-4 rounded-lg border p-4 text-sm">
          InboxKit is not configured. Set{" "}
          <code className="font-mono text-xs">INBOXKIT_API_KEY</code> in your
          environment to enable domain search and mailbox provisioning.
        </div>
      )}

      <div className="space-y-6">
        {/* Domain search + order */}
        <div className="border-border space-y-3 rounded-lg border p-4">
          <div className="text-sm font-medium">Find a domain</div>
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="e.g. acme-outreach"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <Button
              size="sm"
              onClick={search}
              disabled={searching || notConfigured}
            >
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="divide-border divide-y">
              {results.map((r) => (
                <div
                  key={r.domain}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-mono">{r.domain}</span>
                  <div className="flex items-center gap-2">
                    {typeof r.priceUsd === "number" && (
                      <span className="text-muted-foreground text-xs">
                        ${r.priceUsd.toFixed(2)}/yr
                      </span>
                    )}
                    <span
                      className={`text-xs ${r.available ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                    >
                      {r.available ? "available" : "taken"}
                    </span>
                    {r.available && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOrderDomain(r.domain)}
                      >
                        Order
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {orderDomain && (
            <div className="bg-muted/30 space-y-2 rounded-md p-3">
              <div className="text-sm">
                Order{" "}
                <span className="font-mono font-medium">{orderDomain}</span>{" "}
                with:
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Mailboxes</span>
                <input
                  className={`${input} w-20`}
                  type="number"
                  min={1}
                  max={50}
                  value={mailboxCount}
                  onChange={(e) => setMailboxCount(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={placeOrder} disabled={placingOrder}>
                  {placingOrder ? "Placing order…" : "Place order"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOrderDomain(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Owned domains */}
        {domains.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Your domains</div>
            <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
              {domains.map((d) => (
                <div
                  key={d.domain}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-mono">{d.domain}</span>
                  <HealthBadge healthy={d.healthy} status={d.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mailboxes */}
        {mailboxes.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Mailboxes</div>
            <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
              {mailboxes.map((m) => (
                <div
                  key={m.email}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-mono">{m.email}</span>
                  <span className="text-muted-foreground text-xs uppercase">
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Ready mailboxes are imported into Settings → Mailboxes
              automatically once InboxKit reports them active.
            </p>
          </div>
        )}

        {/* Recent orders */}
        {orders.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Recent orders</div>
            <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
              {orders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <div>
                    <div className="font-mono">{o.request?.domain ?? "—"}</div>
                    <div className="text-muted-foreground text-xs">
                      {o.request?.mailboxCount ?? "?"} mailbox(es) ·{" "}
                      {new Date(o.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-muted-foreground text-xs uppercase">
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
