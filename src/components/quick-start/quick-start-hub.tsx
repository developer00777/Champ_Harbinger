"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  Search,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvUpload } from "@/components/campaign/csv-upload";

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "entry" | "companies" | "contacts" | "drafts";

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface StagedCompany {
  id: string; // campaign_organizations.id — the companyId find-contacts wants
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
}

interface StagedContact {
  id: string; // campaign_people.id
  personId: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
}

interface DraftRow {
  id: string;
  contactId: string;
  contact: {
    name: string | null;
    title: string | null;
    email: string;
    company: string | null;
  };
  subject: string;
  bodyText: string;
}

const QUICK_CRITERIA_PLACEHOLDER =
  "B2B SaaS, 10-50 employees, US, seed-funded";

// LinkedIn link normalization — same pattern as components/chat/contact-card.tsx
function linkedinHref(url: string): string {
  return url.startsWith("http")
    ? url
    : `https://linkedin.com/in/${url.replace(/^\//, "")}`;
}

// The drafts editor exposes the plain-text body. The send path uses bodyHtml as
// the primary body, so when the user edits the text we re-derive a simple HTML
// version (paragraph per blank-line-separated block) to keep the two in sync.
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function QuickStartHub() {
  const [step, setStep] = useState<Step>("entry");
  const [error, setError] = useState<string | null>(null);

  // Campaign context
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [quickLine, setQuickLine] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Entry (discover)
  const [criteria, setCriteria] = useState("");
  const [discovering, setDiscovering] = useState(false);

  // Companies staged in the campaign
  const [companies, setCompanies] = useState<StagedCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // Contacts
  const [findingContacts, setFindingContacts] = useState(false);
  const [contacts, setContacts] = useState<StagedContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(),
  );

  // Drafts
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load the user's campaigns for the picker.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/campaigns");
        if (!res.ok) return;
        const json = (await res.json()) as CampaignOption[];
        if (active) setCampaigns(json);
      } catch {
        // non-fatal — the user can still quick-create a campaign
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Ensure a campaign exists; quick-create one from the single "what you sell /
  // who you target" line if none is selected. Returns the campaign id or null.
  const ensureCampaign = useCallback(async (): Promise<string | null> => {
    if (campaignId) return campaignId;

    const line = quickLine.trim();
    if (!line) {
      setError(
        "Pick an existing campaign or describe what you sell and who you target.",
      );
      return null;
    }

    setCreatingCampaign(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Quick Start — ${todayLabel()}`,
          icp: line,
          config: { offering: line, source: "quick_start" },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not create a campaign.");
        return null;
      }
      const created: CampaignOption = {
        id: json.id,
        name: json.name,
        status: json.status,
      };
      setCampaigns((prev) => [created, ...prev]);
      setCampaignId(created.id);
      return created.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign.");
      return null;
    } finally {
      setCreatingCampaign(false);
    }
  }, [campaignId, quickLine]);

  // Re-fetch the campaign's staged companies + contacts.
  const refreshCampaign = useCallback(
    async (id: string): Promise<{ companies: StagedCompany[]; contacts: StagedContact[] }> => {
      const res = await fetch(`/api/campaigns/${id}`);
      if (!res.ok) return { companies: [], contacts: [] };
      const json = (await res.json()) as {
        companies: Array<{
          id: string;
          name: string;
          domain: string | null;
          industry: string | null;
          location: string | null;
        }>;
        contacts: Array<{
          id: string;
          person_id: string;
          name: string;
          title: string | null;
          linkedin_url: string | null;
          company: { name: string } | null;
        }>;
      };
      const companyList: StagedCompany[] = json.companies.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        location: c.location,
      }));
      const contactList: StagedContact[] = json.contacts.map((c) => ({
        id: c.id,
        personId: c.person_id,
        name: c.name,
        title: c.title,
        company: c.company?.name ?? null,
        linkedinUrl: c.linkedin_url,
      }));
      return { companies: companyList, contacts: contactList };
    },
    [],
  );

  // ── Step: Describe criteria → discover ─────────────────────────────────────
  const handleDiscover = useCallback(async () => {
    if (!criteria.trim()) {
      setError("Describe the kind of companies you want to find.");
      return;
    }
    setError(null);
    const id = await ensureCampaign();
    if (!id) return;

    setDiscovering(true);
    try {
      const res = await fetch("/api/quick-start/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: criteria.trim(), campaignId: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Discovery failed.");
        return;
      }
      const { companies: refreshed } = await refreshCampaign(id);
      setCompanies(refreshed);
      setStep("companies");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }, [criteria, ensureCampaign, refreshCampaign]);

  // ── Step: CSV imported → load staged companies ─────────────────────────────
  const handleCsvImported = useCallback(async () => {
    if (!campaignId) return;
    setLoadingCompanies(true);
    try {
      const { companies: refreshed } = await refreshCampaign(campaignId);
      setCompanies(refreshed);
      setStep("companies");
    } finally {
      setLoadingCompanies(false);
    }
  }, [campaignId, refreshCampaign]);

  // ── Step: Find contacts for staged companies ───────────────────────────────
  const handleFindContacts = useCallback(async () => {
    if (!campaignId || companies.length === 0) return;
    setError(null);
    setFindingContacts(true);
    try {
      await Promise.allSettled(
        companies.map((co) =>
          fetch("/api/find-contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: co.id, campaignId }),
          }),
        ),
      );
      const { contacts: refreshed } = await refreshCampaign(campaignId);
      setContacts(refreshed);
      setSelectedContactIds(new Set(refreshed.map((c) => c.id)));
      setStep("contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finding contacts failed.");
    } finally {
      setFindingContacts(false);
    }
  }, [campaignId, companies, refreshCampaign]);

  // ── Step: Draft personalized messages ──────────────────────────────────────
  const handleDraft = useCallback(async () => {
    if (!campaignId) return;
    const ids = [...selectedContactIds];
    if (ids.length === 0) {
      setError("Select at least one contact to draft for.");
      return;
    }
    setError(null);
    setDrafting(true);
    try {
      const res = await fetch("/api/quick-start/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, contactIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Drafting failed.");
        return;
      }
      const rows: DraftRow[] = (json.drafts ?? []).map(
        (d: {
          id: string;
          contactId: string;
          contact: {
            name: string | null;
            title: string | null;
            email: string;
            company: string | null;
          };
          subject: string;
          bodyText: string;
        }) => ({
          id: d.id,
          contactId: d.contactId,
          contact: d.contact,
          subject: d.subject,
          bodyText: d.bodyText,
        }),
      );
      setDrafts(rows);
      if (rows.length === 0) {
        setError(
          "No drafts were created — the selected contacts may be missing email addresses.",
        );
        return;
      }
      setStep("drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }, [campaignId, selectedContactIds]);

  // ── Step: Save edited drafts (reuse PATCH /api/outreach/drafts) ─────────────
  const handleSaveDrafts = useCallback(async () => {
    setSavingDrafts(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: drafts.map((d) => ({
            id: d.id,
            subject: d.subject,
            bodyText: d.bodyText,
            // Keep the HTML body (what actually gets sent) in sync with edits.
            bodyHtml: textToHtml(d.bodyText),
          })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Could not save drafts.");
        return;
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save drafts.");
    } finally {
      setSavingDrafts(false);
    }
  }, [drafts]);

  const reset = () => {
    setStep("entry");
    setError(null);
    setCriteria("");
    setCompanies([]);
    setContacts([]);
    setSelectedContactIds(new Set());
    setDrafts([]);
    setSaved(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <div className="bg-champions-orange/10 text-champions-orange flex h-8 w-8 items-center justify-center rounded-lg">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Quick Start</h2>
          <p className="text-muted-foreground text-xs">
            Go from companies to personalized drafts in a few clicks.
          </p>
        </div>
        <StepIndicator step={step} />
      </header>

      <div className="space-y-4 p-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {step === "entry" && (
          <EntryStep
            campaigns={campaigns}
            campaignId={campaignId}
            onCampaignChange={setCampaignId}
            quickLine={quickLine}
            onQuickLineChange={setQuickLine}
            creatingCampaign={creatingCampaign}
            criteria={criteria}
            onCriteriaChange={setCriteria}
            discovering={discovering}
            onDiscover={handleDiscover}
            onCsvImported={handleCsvImported}
            ensureCampaign={ensureCampaign}
          />
        )}

        {step === "companies" && (
          <CompaniesStep
            companies={companies}
            loading={loadingCompanies}
            findingContacts={findingContacts}
            onBack={reset}
            onFindContacts={handleFindContacts}
          />
        )}

        {step === "contacts" && (
          <ContactsStep
            contacts={contacts}
            selectedIds={selectedContactIds}
            onToggle={(id) =>
              setSelectedContactIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onToggleAll={(checked) =>
              setSelectedContactIds(
                checked ? new Set(contacts.map((c) => c.id)) : new Set(),
              )
            }
            drafting={drafting}
            onBack={() => setStep("companies")}
            onDraft={handleDraft}
          />
        )}

        {step === "drafts" && (
          <DraftsStep
            drafts={drafts}
            onEdit={(id, patch) =>
              setDrafts((prev) =>
                prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
              )
            }
            saving={savingDrafts}
            saved={saved}
            onSave={handleSaveDrafts}
            onDone={reset}
          />
        )}
      </div>
    </section>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const order: Step[] = ["entry", "companies", "contacts", "drafts"];
  const idx = order.indexOf(step);
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      {order.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 w-6 rounded-full ${
            i <= idx ? "bg-champions-orange" : "bg-muted"
          }`}
          aria-hidden
        />
      ))}
    </div>
  );
}

// ── Campaign context control ─────────────────────────────────────────────────

function CampaignContext({
  campaigns,
  campaignId,
  onCampaignChange,
  quickLine,
  onQuickLineChange,
  creating,
}: {
  campaigns: CampaignOption[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  quickLine: string;
  onQuickLineChange: (v: string) => void;
  creating: boolean;
}) {
  return (
    <div className="bg-muted/40 space-y-2 rounded-lg p-3">
      <p className="text-xs font-medium">Campaign context</p>
      <p className="text-muted-foreground text-xs">
        Contacts and drafts need an offering and target profile. Pick a campaign
        or describe yours in one line.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-1/2">
          <Select
            value={campaignId}
            onValueChange={onCampaignChange}
            placeholder="Use an existing campaign…"
            items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            aria-label="Existing campaign"
          />
        </div>
        <span className="text-muted-foreground text-center text-xs sm:px-1">
          or
        </span>
        <div className="sm:w-1/2">
          <Input
            value={quickLine}
            onChange={(e) => onQuickLineChange(e.target.value)}
            placeholder="What you sell / who you target"
            disabled={!!campaignId || creating}
          />
        </div>
      </div>
    </div>
  );
}

// ── Entry step ───────────────────────────────────────────────────────────────

function EntryStep({
  campaigns,
  campaignId,
  onCampaignChange,
  quickLine,
  onQuickLineChange,
  creatingCampaign,
  criteria,
  onCriteriaChange,
  discovering,
  onDiscover,
  onCsvImported,
  ensureCampaign,
}: {
  campaigns: CampaignOption[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  quickLine: string;
  onQuickLineChange: (v: string) => void;
  creatingCampaign: boolean;
  criteria: string;
  onCriteriaChange: (v: string) => void;
  discovering: boolean;
  onDiscover: () => void;
  onCsvImported: () => void;
  ensureCampaign: () => Promise<string | null>;
}) {
  return (
    <div className="space-y-4">
      <CampaignContext
        campaigns={campaigns}
        campaignId={campaignId}
        onCampaignChange={onCampaignChange}
        quickLine={quickLine}
        onQuickLineChange={onQuickLineChange}
        creating={creatingCampaign}
      />

      <Tabs defaultValue="describe">
        <TabsList>
          <TabsTrigger value="describe">
            <Search className="h-3.5 w-3.5" />
            Describe criteria
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-3.5 w-3.5" />
            Upload companies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="describe">
          <div className="space-y-2">
            <Textarea
              value={criteria}
              onChange={(e) => onCriteriaChange(e.target.value)}
              placeholder={QUICK_CRITERIA_PLACEHOLDER}
              rows={3}
            />
            <div className="flex justify-end">
              <Button onClick={onDiscover} disabled={discovering}>
                {discovering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Finding companies…
                  </>
                ) : (
                  <>
                    Find companies
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="upload">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              Upload a CSV or Excel of company names. We&apos;ll stage them in
              your campaign.
            </p>
            <CsvUploadGate
              campaignId={campaignId}
              ensureCampaign={ensureCampaign}
              onImported={onCsvImported}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// CsvUpload needs a campaignId up-front. If none is selected yet, we create one
// first (from the quick line) and then render the real CsvUpload.
function CsvUploadGate({
  campaignId,
  ensureCampaign,
  onImported,
}: {
  campaignId: string;
  ensureCampaign: () => Promise<string | null>;
  onImported: () => void;
}) {
  // A campaign created locally (via the quick line) before the parent's
  // campaignId is set. The parent's campaignId always wins when present.
  const [createdId, setCreatedId] = useState<string>("");
  const effectiveId = campaignId || createdId;

  if (effectiveId) {
    return <CsvUpload campaignId={effectiveId} onImported={onImported} />;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const id = await ensureCampaign();
        if (id) setCreatedId(id);
      }}
    >
      <Upload className="h-4 w-4" />
      Set up a campaign to upload into
    </Button>
  );
}

// ── Companies step ───────────────────────────────────────────────────────────

function CompaniesStep({
  companies,
  loading,
  findingContacts,
  onBack,
  onFindContacts,
}: {
  companies: StagedCompany[];
  loading: boolean;
  findingContacts: boolean;
  onBack: () => void;
  onFindContacts: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Building2 className="text-muted-foreground h-4 w-4" />
        {loading
          ? "Loading companies…"
          : `${companies.length} ${companies.length === 1 ? "company" : "companies"} staged`}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No companies were staged. Go back and try different criteria or a CSV.
        </p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {companies.map((co) => (
            <div
              key={co.id}
              className="border-border bg-background flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{co.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {[co.domain, co.industry, co.location]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Start over
        </Button>
        <Button
          onClick={onFindContacts}
          disabled={findingContacts || companies.length === 0}
        >
          {findingContacts ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finding contacts…
            </>
          ) : (
            <>
              <Users className="h-4 w-4" />
              Find contacts
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Contacts step ────────────────────────────────────────────────────────────

function ContactsStep({
  contacts,
  selectedIds,
  onToggle,
  onToggleAll,
  drafting,
  onBack,
  onDraft,
}: {
  contacts: StagedContact[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  drafting: boolean;
  onBack: () => void;
  onDraft: () => void;
}) {
  const allSelected =
    contacts.length > 0 && selectedIds.size === contacts.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="text-muted-foreground h-4 w-4" />
          {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}{" "}
          found
        </div>
        {contacts.length > 0 && (
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleAll(e.target.checked)}
              className="accent-champions-orange h-3.5 w-3.5"
            />
            Select all
          </label>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No contacts found for these companies yet. You can go back and stage
          more companies.
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {contacts.map((c) => (
            <label
              key={c.id}
              className="border-border bg-background flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={() => onToggle(c.id)}
                className="accent-champions-orange h-3.5 w-3.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.linkedinUrl && (
                    <a
                      href={linkedinHref(c.linkedinUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={`${c.name} on LinkedIn`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={onDraft}
          disabled={drafting || selectedIds.size === 0}
        >
          {drafting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Drafting…
            </>
          ) : (
            <>
              <Mail className="h-4 w-4" />
              Draft {selectedIds.size > 0 ? selectedIds.size : ""}{" "}
              {selectedIds.size === 1 ? "message" : "messages"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Drafts step ──────────────────────────────────────────────────────────────

function DraftsStep({
  drafts,
  onEdit,
  saving,
  saved,
  onSave,
  onDone,
}: {
  drafts: DraftRow[];
  onEdit: (id: string, patch: Partial<Pick<DraftRow, "subject" | "bodyText">>) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mail className="text-muted-foreground h-4 w-4" />
        {drafts.length} personalized{" "}
        {drafts.length === 1 ? "draft" : "drafts"}
      </div>

      <div className="max-h-[28rem] space-y-3 overflow-y-auto">
        {drafts.map((d) => (
          <div
            key={d.id}
            className="border-border bg-background space-y-2 rounded-lg border p-3"
          >
            <div className="text-muted-foreground text-xs">
              To: <span className="text-foreground">{d.contact.name}</span>
              {d.contact.title ? ` · ${d.contact.title}` : ""}
              {d.contact.company ? ` · ${d.contact.company}` : ""} ·{" "}
              {d.contact.email}
            </div>
            <Input
              value={d.subject}
              onChange={(e) => onEdit(d.id, { subject: e.target.value })}
              aria-label="Subject"
              className="font-medium"
            />
            <Textarea
              value={d.bodyText}
              onChange={(e) => onEdit(d.id, { bodyText: e.target.value })}
              aria-label="Body"
              rows={6}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {saved ? "Done" : "Discard & start over"}
        </Button>
        {saved ? (
          <span className="text-champions-orange flex items-center gap-1.5 text-sm font-medium">
            <Check className="h-4 w-4" />
            Drafts saved
          </span>
        ) : (
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save drafts"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
