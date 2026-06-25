"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  PencilLine,
  Search,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvUpload } from "@/components/campaign/csv-upload";
import { bestTitleScore } from "@/lib/services/title-match";

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

const STEPS: { key: Step; label: string }[] = [
  { key: "entry", label: "Describe" },
  { key: "companies", label: "Companies" },
  { key: "contacts", label: "Contacts" },
  { key: "drafts", label: "Drafts" },
];

const TRY_EXAMPLES = [
  "Fintech, Series A, EU",
  "Dev tools, US, PLG",
  "Healthcare SaaS",
];

const ROLE_SUGGESTIONS = [
  "CEO / Founder",
  "CTO",
  "VP Engineering",
  "Head of Product",
  "VP Sales",
  "Head of Marketing",
];

// Title-match score at/above which a found contact is auto-accepted (selected)
// for drafting; below this the rep eyeballs and opts in (v2 spec §4).
const ACCEPT_THRESHOLD = 0.6;

/** Append a role to the comma-separated list if not already present. */
function appendRole(current: string, role: string): string {
  const parts = current
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === role.toLowerCase())) return current;
  return [...parts, role].join(", ");
}

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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const [pickExisting, setPickExisting] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Entry — the ICP/context line, used both to discover companies and as the
  // new campaign's offering/positioning when one is auto-created.
  const [criteria, setCriteria] = useState("");
  // Roles to reach (comma-separated). Drives the contact-finding filter via the
  // campaign ICP targetTitles. Empty → engine defaults to decision-makers.
  const [roles, setRoles] = useState("");
  const [entryTab, setEntryTab] = useState<"describe" | "upload">("describe");
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

  // Ensure a campaign exists; quick-create one from the criteria line if none
  // is selected. Returns the campaign id or null.
  const ensureCampaign = useCallback(async (): Promise<string | null> => {
    if (campaignId) return campaignId;

    const line = criteria.trim();
    if (!line) {
      setError("Describe who you want to reach, or pick an existing campaign.");
      return null;
    }

    setCreatingCampaign(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Quick Start · ${todayLabel()}`,
          icp: line,
          targetTitles: roles
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean),
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
      setError(
        err instanceof Error ? err.message : "Could not create campaign.",
      );
      return null;
    } finally {
      setCreatingCampaign(false);
    }
  }, [campaignId, criteria, roles]);

  // Re-fetch the campaign's staged companies + contacts.
  const refreshCampaign = useCallback(
    async (
      id: string,
    ): Promise<{ companies: StagedCompany[]; contacts: StagedContact[] }> => {
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
    const id = campaignId;
    if (!id) return;
    setLoadingCompanies(true);
    try {
      const { companies: refreshed } = await refreshCampaign(id);
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
      // Auto-accept the strong role-matches; leave the borderline ones for the
      // rep to eyeball (v2 spec §4). With no roles set, accept everything.
      const requestedTitles = roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      const accepted =
        requestedTitles.length > 0
          ? refreshed.filter(
              (c) =>
                bestTitleScore(c.title, requestedTitles) >= ACCEPT_THRESHOLD,
            )
          : refreshed;
      setSelectedContactIds(new Set(accepted.map((c) => c.id)));
      setStep("contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finding contacts failed.");
    } finally {
      setFindingContacts(false);
    }
  }, [campaignId, companies, refreshCampaign, roles]);

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
    setCompanies([]);
    setContacts([]);
    setSelectedContactIds(new Set());
    setDrafts([]);
    setSaved(false);
  };

  // Chips derived from the criteria line for the "This run" rail.
  const runChips = criteria
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section>
      {/* Header: sparkles + title + horizontal step rail */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="bg-peach text-peach-foreground flex h-10 w-10 items-center justify-center rounded-xl">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold tracking-tight">Quick Start</h2>
          <p className="text-muted-foreground text-sm">
            Go from companies to personalized drafts in a few clicks.
          </p>
        </div>
        <StepRail current={step} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {step === "entry" && (
            <EntryStep
              campaigns={campaigns}
              campaignId={campaignId}
              onCampaignChange={setCampaignId}
              pickExisting={pickExisting}
              onTogglePickExisting={() => setPickExisting((v) => !v)}
              criteria={criteria}
              onCriteriaChange={setCriteria}
              roles={roles}
              onRolesChange={setRoles}
              entryTab={entryTab}
              onEntryTab={setEntryTab}
              discovering={discovering}
              onDiscover={handleDiscover}
              creatingCampaign={creatingCampaign}
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
              requestedTitles={roles
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean)}
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

          {step === "entry" && <InfoCards />}
        </div>

        <RunRail
          step={step}
          chips={runChips}
          companiesCount={companies.length}
          contactsCount={contacts.length}
          draftsCount={drafts.length}
        />
      </div>
    </section>
  );
}

// ── Step rail (horizontal) ───────────────────────────────────────────────────

function StepRail({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="hidden items-center sm:flex">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                i <= idx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${
                i === idx ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && <span className="bg-border mx-2 h-px w-6" />}
        </div>
      ))}
    </div>
  );
}

// ── This-run rail ────────────────────────────────────────────────────────────

function RunRail({
  step,
  chips,
  companiesCount,
  contactsCount,
  draftsCount,
}: {
  step: Step;
  chips: string[];
  companiesCount: number;
  contactsCount: number;
  draftsCount: number;
}) {
  const rows: { icon: typeof Building2; label: string; value: string }[] = [
    {
      icon: Building2,
      label: "Companies",
      value: companiesCount > 0 ? String(companiesCount) : "not started",
    },
    {
      icon: Users,
      label: "Contacts",
      value: contactsCount > 0 ? String(contactsCount) : "pending",
    },
    {
      icon: Mail,
      label: "Drafts",
      value: draftsCount > 0 ? String(draftsCount) : "pending",
    },
  ];

  const nextCopy: Record<Step, string> = {
    entry:
      "Describe your buyer, then I find matching companies and the right people inside them.",
    companies:
      "Review the companies I staged, then find the right people inside them.",
    contacts:
      "Pick who to reach, then I draft a personalized message for each.",
    drafts: "Edit anything, then save the drafts to your outreach queue.",
  };

  return (
    <aside className="bg-card shadow-card h-fit rounded-xl border border-border p-4">
      <p className="eyebrow mb-3">This run</p>

      {chips.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="bg-muted text-foreground/80 rounded-md px-2 py-1 text-xs"
            >
              {c}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mb-4 text-xs">
          Your targeting shows up here once you describe a buyer.
        </p>
      )}

      <div className="space-y-1">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between border-t border-border py-2.5 first:border-t-0"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-muted-foreground flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                <r.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-medium">{r.label}</span>
            </div>
            <span className="text-muted-foreground text-xs">{r.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <p className="eyebrow mb-1.5 flex items-center gap-1.5">
          <ArrowRight className="h-3 w-3" /> Next
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {nextCopy[step]}
        </p>
      </div>
    </aside>
  );
}

// ── Info cards (entry only) ──────────────────────────────────────────────────

function InfoCards() {
  const items = [
    {
      icon: PencilLine,
      title: "You describe",
      body: "One line on who you sell to.",
    },
    {
      icon: Search,
      title: "I research",
      body: "Find companies, people, and signals.",
    },
    { icon: Check, title: "You review", body: "Edit drafts, then send." },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <div
          key={it.title}
          className="bg-card flex items-start gap-2.5 rounded-xl border border-border p-3"
        >
          <span className="bg-peach text-peach-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <it.icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="text-muted-foreground text-xs">{it.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Entry step ───────────────────────────────────────────────────────────────

function EntryStep({
  campaigns,
  campaignId,
  onCampaignChange,
  pickExisting,
  onTogglePickExisting,
  criteria,
  onCriteriaChange,
  roles,
  onRolesChange,
  entryTab,
  onEntryTab,
  discovering,
  onDiscover,
  creatingCampaign,
  onCsvImported,
  ensureCampaign,
}: {
  campaigns: CampaignOption[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  pickExisting: boolean;
  onTogglePickExisting: () => void;
  criteria: string;
  onCriteriaChange: (v: string) => void;
  roles: string;
  onRolesChange: (v: string) => void;
  entryTab: "describe" | "upload";
  onEntryTab: (t: "describe" | "upload") => void;
  discovering: boolean;
  creatingCampaign: boolean;
  onDiscover: () => void;
  onCsvImported: () => void;
  ensureCampaign: () => Promise<string | null>;
}) {
  return (
    <div className="bg-card shadow-card rounded-xl border border-border p-5">
      <p className="eyebrow mb-2">Campaign context</p>
      <h3 className="text-lg font-semibold">Who do you want to reach?</h3>
      <p className="text-muted-foreground mt-0.5 text-sm">
        Describe your ideal customer, or drop a list. I&apos;ll do the homework.
      </p>

      {/* Source tabs */}
      <div className="bg-muted mt-4 inline-flex gap-1 rounded-lg p-1">
        <TabButton
          active={entryTab === "describe"}
          onClick={() => onEntryTab("describe")}
          icon={Search}
        >
          Describe criteria
        </TabButton>
        <TabButton
          active={entryTab === "upload"}
          onClick={() => onEntryTab("upload")}
          icon={Upload}
        >
          Upload list
        </TabButton>
      </div>

      <Textarea
        value={criteria}
        onChange={(e) => onCriteriaChange(e.target.value)}
        placeholder="B2B SaaS, 10–50 employees, US, seed-funded"
        rows={3}
        className="mt-3.5"
      />

      {/* Target roles — filters which people we find inside each company */}
      <div className="mt-3.5">
        <label className="text-muted-foreground mb-1.5 block text-xs">
          Roles to reach{" "}
          <span className="opacity-70">
            (optional — defaults to decision-makers)
          </span>
        </label>
        <input
          value={roles}
          onChange={(e) => onRolesChange(e.target.value)}
          placeholder="CTO, VP Engineering, Head of Product"
          aria-label="Roles to reach"
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ROLE_SUGGESTIONS.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => onRolesChange(appendRole(roles, role))}
              className="hover:border-primary hover:text-foreground text-muted-foreground rounded-full border border-border px-2.5 py-1 text-xs transition-colors"
            >
              + {role}
            </button>
          ))}
        </div>
      </div>

      {entryTab === "describe" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-0.5 text-xs">Try:</span>
          {TRY_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onCriteriaChange(ex)}
              className="hover:border-primary hover:text-foreground text-muted-foreground rounded-full border border-border px-2.5 py-1 text-xs transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {entryTab === "describe" ? (
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={onDiscover}
            disabled={discovering || creatingCampaign}
          >
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
          <button
            type="button"
            onClick={onTogglePickExisting}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            or pick an existing campaign
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-sm">
            Upload a CSV or Excel of company names. I&apos;ll stage them into
            your campaign (the line above becomes its context).
          </p>
          <CsvUploadGate
            campaignId={campaignId}
            ensureCampaign={ensureCampaign}
            onImported={onCsvImported}
          />
          <button
            type="button"
            onClick={onTogglePickExisting}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            or pick an existing campaign
          </button>
        </div>
      )}

      {pickExisting && (
        <div className="mt-3 max-w-sm">
          <Select
            value={campaignId}
            onValueChange={onCampaignChange}
            placeholder="Use an existing campaign…"
            items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            aria-label="Existing campaign"
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

// CsvUpload needs a campaignId up-front. If none is selected yet, we create one
// first (from the criteria line) and then render the real CsvUpload.
function CsvUploadGate({
  campaignId,
  ensureCampaign,
  onImported,
}: {
  campaignId: string;
  ensureCampaign: () => Promise<string | null>;
  onImported: () => void;
}) {
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
    <div className="bg-card shadow-card space-y-3 rounded-xl border border-border p-5">
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
              className="bg-background flex items-center gap-3 rounded-lg border border-border px-3 py-2"
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

function MatchBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone =
    score >= 0.85
      ? "bg-success/15 text-success"
      : score >= 0.6
        ? "bg-peach text-peach-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tone}`}
      title="How well this person's title matches your target roles"
    >
      {pct}% match
    </span>
  );
}

function ContactsStep({
  requestedTitles,
  contacts,
  selectedIds,
  onToggle,
  onToggleAll,
  drafting,
  onBack,
  onDraft,
}: {
  requestedTitles: string[];
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

  // Score each contact's title against the requested roles and rank best-first
  // so the rep reviews the strongest matches at the top (v2 spec §4 Discover).
  const ranked =
    requestedTitles.length > 0
      ? [...contacts]
          .map((c) => ({ c, score: bestTitleScore(c.title, requestedTitles) }))
          .sort((a, b) => b.score - a.score)
      : contacts.map((c) => ({ c, score: 0 }));

  const matchCount = ranked.filter((r) => r.score >= ACCEPT_THRESHOLD).length;

  return (
    <div className="bg-card shadow-card space-y-3 rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="text-muted-foreground h-4 w-4" />
          <div>
            <div>
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}{" "}
              found
            </div>
            {requestedTitles.length > 0 && contacts.length > 0 && (
              <div className="text-muted-foreground text-xs font-normal">
                {matchCount} match your roles — pre-selected; review the rest
              </div>
            )}
          </div>
        </div>
        {contacts.length > 0 && (
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleAll(e.target.checked)}
              className="accent-primary h-3.5 w-3.5"
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
          {ranked.map(({ c, score }) => (
            <label
              key={c.id}
              className="bg-background flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={() => onToggle(c.id)}
                className="accent-primary h-3.5 w-3.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {requestedTitles.length > 0 && score > 0 && (
                    <MatchBadge score={score} />
                  )}
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
        <Button onClick={onDraft} disabled={drafting || selectedIds.size === 0}>
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
  onEdit: (
    id: string,
    patch: Partial<Pick<DraftRow, "subject" | "bodyText">>,
  ) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onDone: () => void;
}) {
  return (
    <div className="bg-card shadow-card space-y-3 rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mail className="text-muted-foreground h-4 w-4" />
        {drafts.length} personalized {drafts.length === 1 ? "draft" : "drafts"}
      </div>

      <div className="max-h-[28rem] space-y-3 overflow-y-auto">
        {drafts.map((d) => (
          <div
            key={d.id}
            className="bg-background space-y-2 rounded-lg border border-border p-3"
          >
            <div className="text-muted-foreground text-xs">
              To: <span className="text-foreground">{d.contact.name}</span>
              {d.contact.title ? ` · ${d.contact.title}` : ""}
              {d.contact.company ? ` · ${d.contact.company}` : ""} ·{" "}
              {d.contact.email}
            </div>
            <input
              value={d.subject}
              onChange={(e) => onEdit(d.id, { subject: e.target.value })}
              aria-label="Subject"
              className="border-input bg-card focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
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
          <span className="text-success flex items-center gap-1.5 text-sm font-medium">
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
