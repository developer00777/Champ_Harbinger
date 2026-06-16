# Champ Harbinger — Waterfall Enrichment + Owned Master DB (Design Spec)

**Date:** 2026-06-17
**Branch / worktree:** `feat/waterfall-enrichment` → `/Users/deep/Apps&Projects/ChampHarbinger-waterfall`
**Status:** SP1 designed in depth; SP2/SP3 sketched (each gets its own spec → plan → build cycle).

---

## 0. Context & goal

ChampHarbinger is the prospecting hub in the Champions pipeline
(`ChampSet → ChampHarbinger → ChampOracle → ChampIQ`). It already runs **entirely on one
OpenRouter key** for LLM work and has a mature stack: discovery (LakeB2B / SearXNG / public
web), enrichment (self-hosted Obscura + Trafilatura scraping, LinkedIn/X scrapers, website
extraction, email-pattern/MX resolution), signals + `priorityScore` scoring, email
composition (email-skills), and a send path (mailbox SMTP/IMAP → ChampMail).

A vendor patch (`champharbinger-waterfall-enrichment.patch`) introduced a *parallel*,
**paid-vendor-centric** waterfall engine + a standalone MCP server. It duplicates existing
capability and only works end-to-end with paid keys. This project **re-grounds** that engine
on Harbinger's owned + LLM-scraping stack, makes it the foundation of an **owned master
database**, and wires it into the broader STR flow.

### The three sub-projects (build order SP1 → SP3 → SP2)

- **SP1 — Waterfall Enrichment Engine + Owned Master DB** *(this spec, in depth)*. The
  foundation. LakeB2B API first → configurable vendor priority list for requested-but-missing
  fields → owned LLM scraping as the $0 fallback → accumulate verified results into a
  Harbinger-owned master DB.
- **SP3 — Signal-gated 5-level personalization → ChampMail send w/ human confirmation**
  *(separate spec)*. Standalone 5-level personalization module; level auto-selected from
  brand + company/role + signal strength; human-confirmation gate before ChampMail send.
- **SP2 — ChampSet ↔ Harbinger MCP integration** *(separate spec)*. Harbinger exposes an MCP
  server (the SP1 engine behind it) + a dataset-import seam so a ChampSet universe flows in,
  gets enriched + scored.

### SP1 success criteria

1. `enrichContact(seed)` / `enrichSet(...)` return a populated, confidence-scored record using
   **only `DATABASE_URL` + `OPENROUTER_API_KEY`** (plus optional self-hosted scrape URLs). Zero
   paid-vendor calls when no vendor keys are present.
2. LakeB2B data API is the **primary** source; only fields it leaves empty *and* that were
   requested escalate down the waterfall.
3. Every accepted enrichment is **diffed against and copied into** the Harbinger-owned master
   tables, with provenance + a join key to LakeB2B and timestamps that support a later sync.
4. The vendor escalation order is **configurable by price + per-field coverage**.
5. Full unit + integration coverage; engine lives inside the Next build; graceful degradation
   on every missing env var; deployment-ready.

### Non-goals (SP1)

- The standalone MCP server (SP2) and the ChampSet dataset connector (SP2).
- The 5-level personalization module and ChampMail send gate (SP3).
- The *actual* periodic LakeB2B↔master sync run (schema + a stubbed job only; full sync
  deferred per product owner: "every day or week, later on").
- Outlook/Gmail OAuth and the ChampIQ handoff (explicitly later).

---

## 1. Architecture overview

```
                        enrichContact(seed, requiredFields, opts)
                                       │
                 ┌─────────────────────┼──────────────────────────────────────┐
                 ▼                                                              │
        [ Owned master read ]  short-circuit: fresh owned copy?  ──hit────────►│ merge
                 │ miss/stale                                                   │
                 ▼                                                              │
        [ PRIMARY: LakeB2B data API ]  getLakeB2BClient()  ────────────────────►│ merge
                 │  compute still-missing REQUESTED fields                      │
                 ▼                                                              │
        [ WATERFALL over provider priority list ] (only for missing+requested) │
            for each provider in user-configured order (price × coverage):     │
              owned_llm_scrape ($0)   ── WebExtraction/LinkedIn/X/SearXNG       │
                                          + extract.ts (OpenRouter)            ─►│ merge
              proxycurl / pdl / apollo / zoominfo / resellers (paid, optional) ─►│ merge
            stop when requested fields filled OR budget hit OR list exhausted   │
                 ▼                                                              │
        [ EMAIL GATE ] pattern + MX on every candidate email (email-tools) ────►│ gate
                 ▼                                                              ▼
        [ confidence model ] base × freshness × verification; best-value merge; accept
                 ▼
        [ PERSIST ] enrichment_* tables (job, provenance, provider_calls, cache)
                 ▼
        [ MASTER BUILD-UP ] diff vs master_contacts/master_organizations →
                            upsert owned copy (source, confidence, last_verified,
                            lakeb2b_id, last_synced_at=null) + master_writeback_log
                 ▼
        [ optional ] mirror best fields into existing people/organizations.enrichmentData
```

**Kept from the patch** (good, mostly pure/testable): `types.ts`, `confidence.ts`,
`orchestrator.ts`, `cache.ts`, `writeback.ts`, `providers/base.ts`, `config.ts`, the two unit
test files, and the `enrichment_*` Drizzle tables.

**Re-grounded** (data sources): every adapter's *source*; the rigid `Tier` ladder gains a
**configurable provider-priority layer**; the email gate uses Harbinger's pattern+MX logic;
the write-back targets **real Harbinger-owned master tables** instead of an illustrative one.

---

## 2. Data model (new Drizzle tables)

Migration renumbered to **`0007_waterfall_enrichment.sql`** (repo is at `0006`). Tables added to
`db/schema.ts` using the existing `timestamps` helper, `pgTable` style, and clerk scoping.
After editing `schema.ts`, run `pnpm drizzle-kit generate` to refresh the meta snapshot.

### 2.1 Engine tables (from the patch, retained)
- `enrichment_contacts` — working contact record threaded through a run (denormalized
  best-value columns + scores + status). Clerk-scoped.
- `enrichment_jobs` — one row per waterfall run (start/resolved tier, required fields, spend,
  lifecycle). Clerk-scoped.
- `enrichment_field_provenance` — insert-only `(contact, field)` observation history.
- `enrichment_provider_calls` — audit + future ML training data; stores ONLY minimal
  identifiers actually sent.
- `enrichment_cache` — per-provider TTL cache keyed by `(identity_hash, provider)`.
- `master_writeback_log` — audit of writes into the owned master (old→new per field +
  rollback token).

### 2.2 Owned master tables (NEW — the Harbinger master DB)
The patch wrote to an illustrative external `master_contacts`. We make these **real,
Harbinger-owned tables in the app DB**, the accumulation target and the thing later synced
against the LakeB2B master.

- **`master_contacts`**
  - identity: `id uuid pk`, `lakeb2b_id text` (join key to LakeB2B master, nullable),
    `email text`, `linkedin_url text`, `full_name text`, `first_name`, `last_name`,
    `domain text`, `company_name text`.
  - data: `phone`, `title`, `seniority`, plus `firmographics jsonb`.
  - provenance: `source text` (e.g. `lakeb2b`, `harbinger_waterfall`, `owned_scrape`,
    `proxycurl`…), `confidence numeric(4,3)`, `verified boolean`,
    `field_sources jsonb` (per-field {source,confidence,verified,observedAt}).
  - sync: `last_verified timestamptz`, `last_synced_at timestamptz` (null until first
    LakeB2B sync), `sync_status text default 'local_only'`
    (`local_only | in_sync | ahead_of_lakeb2b | behind_lakeb2b | conflict`).
  - housekeeping: `clerk_org_id text` (owning tenant, nullable for shared pool),
    `created_at`, `updated_at`.
  - indexes: email, linkedin_url, domain, `lakeb2b_id`, `(full_name, domain)`, `sync_status`.
- **`master_organizations`**
  - `id`, `lakeb2b_id`, `domain`, `name`, `industry`, `employee_count`, `revenue_band`,
    `firmographics jsonb`, `source`, `confidence`, `last_verified`, `last_synced_at`,
    `sync_status`, timestamps; indexes on domain, name, `lakeb2b_id`, `sync_status`.

> The optional **external** LakeB2B master DB (`LAKEB2B_MASTER_DSN`) is supported as a *read*
> source for the future sync/compare job, but the owned master above is the build-up target and
> the default. If `LAKEB2B_MASTER_DSN` is unset, sync simply no-ops.

---

## 3. Provider priority list (config-driven waterfall)

The core refinement over the patch. Instead of a fixed `T0..T4` ladder, providers are ordered
by a **priority list keyed on price × per-field coverage**, configurable without code.

### 3.1 Shape (`EnrichmentSettings.providerPriority`)
```ts
interface ProviderPriorityEntry {
  name: string;            // 'owned_scrape' | 'proxycurl' | 'pdl' | 'apollo' | 'zoominfo' | 'reseller:<id>'
  enabled: boolean;        // false → skipped (also auto-false when key/credential absent)
  costPerCall: number;     // USD; owned_scrape ≈ 0 (OpenRouter tokens tracked separately)
  covers: string[];        // fields this provider is good at: ['email','phone','title',...]
  rank: number;            // lower = tried earlier
}
```
- Sourced from `PROVIDER_PRIORITY` env JSON (with safe defaults), later movable to a DB-backed
  settings row + a Settings UI (out of SP1 scope; env is the SP1 mechanism).
- **LakeB2B data API is pinned first**, ahead of the priority list — it is the primary source,
  not a list entry.
- Default ordering (cheapest/owned first, paid by typical price): `owned_scrape (0)` →
  `proxycurl` → `pdl` → `apollo` → `zoominfo` → `reseller:*`. The product owner overrides this.

### 3.2 How the orchestrator uses it
1. Compute `missingRequested = requiredFields − fieldsAlreadyFilled` after the owned-master read
   and LakeB2B.
2. If empty → accept (no escalation, no spend).
3. Else iterate `providerPriority` by `rank`; for each enabled provider whose `covers` intersects
   `missingRequested`, call it (cache-checked), merge, re-gate email, recompute `missingRequested`.
4. Stop when `missingRequested` empty, per-job/per-tier budget hit, `maxTier` reached, or list
   exhausted. Per-provider circuit breaker still applies.

> The existing `Tier` enum is retained only as a coarse grouping for **budget caps and accept
> thresholds**; the *ordering* of escalation is the priority list. This keeps the patch's budget
> + threshold + breaker machinery intact while satisfying "ordered by price × coverage."

---

## 4. The owned LLM-scraping provider (`owned_scrape`) + `extract.ts`

The provider that makes "good scraping enrichment on one OpenRouter key" real.

- **Adapter `providers/ownedScrape.ts`** (`covers: email, phone, title, seniority, linkedin,
  company`, `costPerCall: 0`). Steps, reusing existing services:
  1. If domain known → `WebExtractionService` (direct → Obscura → Trafilatura) on home/team/
     contact pages; `findPeopleOnDomain` + `contact-filter` for candidate people.
  2. If LinkedIn/X URL known → `linkedin-service` / `x-service`.
  3. If identifiers thin → SearXNG (`searxng-client`) for `"<name> <company>"` pages.
  4. Hand all gathered text/profile JSON + the seed to **`extract.ts`**.
- **`extract.ts`** (the new heart): pure-ish unit. Input: scraped text/HTML/profile JSON +
  `Contact` seed. Calls OpenRouter via `generateObject` (`models.classification` for routine
  parsing, `models.default` for hard cases) with a zod schema → returns canonical `FieldValue`s
  + firmographics, each provenance-stamped (`source:'owned_scrape'`, computed confidence,
  `verified:false` so the email gate runs). The model is **injected** so unit tests pass a fake.
- Privacy unchanged: only `minimalIdentifiers` ever leave for any *external* provider; the LLM
  call sends scraped public text + identifiers, consistent with existing enrich routes.

---

## 5. Email gate (owned, no paid verifiers)

`providers/emailGate.ts` replaces NeverBounce/ZeroBounce/Hunter as the **default** gate, reusing
Harbinger's `email-tools` / `email-pattern`:
- Infer/confirm the org email pattern; MX-check the domain (existing logic).
- Map to `EmailVerdict`: pattern-match + MX ok → `deliverable`; MX ok but generic/catch-all
  domain → `catch_all`; no MX / known-bad → `undeliverable`; otherwise `unknown`.
- `confidence.applyEmailGate` then boosts/caps/discards exactly as in the patch.
- Paid verifiers remain as **optional** providers (off without keys); when present they can be
  placed in the priority list too.

---

## 6. Write-back & master build-up

On **accept** (status `accepted`), `MasterDBWriter` (re-pointed at the owned tables):
1. Select fields that are verified and above the confidence floor (email must have passed the
   gate).
2. Load the existing `master_contacts` row by `email` → `linkedin_url` → `(full_name, domain)`;
   diff old→new.
3. Upsert the owned copy: set fields, `source`, `confidence`, `field_sources`,
   `last_verified=now()`, `sync_status='local_only'` (or `ahead_of_lakeb2b` if it already had a
   `lakeb2b_id`), `lakeb2b_id` if LakeB2B supplied one this run.
4. Write `master_writeback_log` (old→new, rollback token).
5. **Optionally mirror** the best email/title/linkedin into the existing
   `people`/`organizations.enrichmentData` + `email_pattern` so the rest of Harbinger benefits
   immediately (behind a `mirrorToWorkingTables` flag, default true).

This is the "compare to the copy, make a copy in our own master DB, build it up" behavior.

### 6.1 Future sync (schema-ready, stubbed)
`master-sync.ts` exposes `syncWithLakeB2BMaster()` (reads `LAKEB2B_MASTER_DSN` or the LakeB2B
API, diffs by `lakeb2b_id`/email, updates `sync_status` + `last_synced_at`). SP1 ships the
function signature + table columns + a `pnpm enrich:sync` script stub and a registered pg-boss
job that is **not scheduled**. Actual daily/weekly scheduling is deferred per the product owner.

---

## 7. Configuration & env

All optional with safe defaults; **degrade gracefully** (matches existing Harbinger patterns):

- Already present: `DATABASE_URL`, `OPENROUTER_API_KEY`, `HARBINGER_DEFAULT_MODEL`,
  `LAKEB2B_API_URL`/`LAKEB2B_API_KEY`/`LAKEB2B_MOCK`, `OBSCURA_GATEWAY_URL`,
  `TRAFILATURA_BASE_URL`, `SEARXNG_URL`.
- New: `PROVIDER_PRIORITY` (JSON; default ordering baked in), `LAKEB2B_MASTER_DSN` (optional,
  future sync), the patch's tunables (`ACCEPT_THRESHOLD_T0..T4`, `FRESHNESS_HALF_LIFE_DAYS`,
  `VERIFICATION_BOOST`, `CATCH_ALL_EMAIL_CAP`, budgets, circuit breaker, cache TTLs,
  `ENRICHMENT_HTTP_TIMEOUT_MS`), and **optional** paid-vendor keys
  (`PROXYCURL_API_KEY`/`PDL_API_KEY`/`APOLLO_API_KEY`/`ZOOMINFO_*`/`RESELLER_ENDPOINTS`).
- Provider keys resolve via existing `getUserApiKey(keyName, clerkUserId, envFallback)` first
  (BYOK), then env — same as the rest of the repo.

**Minimum to run end-to-end in prod:** `DATABASE_URL` + `OPENROUTER_API_KEY` (+ `LAKEB2B_*` for
the primary source; + scrape URLs for best owned coverage).

---

## 8. Public surface & integration

- `src/lib/enrichment/engine.ts` exports `enrichContact`, `enrichSet`, `getEnrichment`,
  `listProviders` (same shapes the patch + SP2 expect).
- `src/lib/lakeb2b/client.ts` gains optional `lookupMaster()` (owned-master read only) and
  `enrichPerson()` (full waterfall) without breaking the existing
  `LakeB2BClient`/`createLakeB2BClient`/`getLakeB2BClient` interface; heavy engine lazy-imported.
- Cost: billable provider calls log to `apiUsage` via `trackUsage({service:'enrichment'})`
  (add `'enrichment'` to the `ServiceName` union). OpenRouter LLM spend already tracked by
  `ai/provider`.
- **Thin route `POST /api/v1/enrich/waterfall`** (Bearer `chh_`, mirroring existing v1 auth) for
  end-to-end testing and future ChampSet/IQ callers. Engine stays in the Next build (no
  `tsconfig` `mcp/` exclude in SP1).

---

## 9. Testing strategy (TDD-first — "test it → develop → e2e test → present")

1. **Unit (write first):**
   - `confidence.test.ts`, `orchestrator.test.ts` — ported from the patch + extended for the
     priority-list ordering and the owned email gate verdict mapping.
   - `extract.test.ts` — `extract.ts` with a **mocked** `generateObject`: asserts canonical
     fields + confidence/provenance from representative scraped text.
   - `providerPriority.test.ts` — ordering, `covers` intersection, enabled/disabled, budget stop.
   - `master-writeback.test.ts` — diff + upsert logic against a fake DB.
2. **Integration:** `enrichContact` with `LAKEB2B_MOCK=true`, scrape stack + `generateObject`
   mocked → asserts requested fields filled from LakeB2B + owned scrape only, **zero paid
   calls**, a `master_contacts` upsert + `master_writeback_log` row.
3. **E2E (live-ish, presented to you):** real domain, only `OPENROUTER_API_KEY` (+ scrape URLs
   if available) → populated, scored record + master row; then a paid-key run to confirm the
   priority list escalates correctly.
4. **Build gates:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm drizzle-kit
   generate` clean. Em-dash check on added lines (repo convention).

---

## 10. Deployment readiness

- Migration `0007_*` is idempotent (`CREATE TABLE IF NOT EXISTS`, guarded constraints); runs via
  `pnpm db:migrate` after `pnpm drizzle-kit generate`.
- No new always-on dependency: works with just `DATABASE_URL` + `OPENROUTER_API_KEY`.
- All external calls go through `fetchWithTimeout`; circuit breaker + budget caps bound spend and
  failures; every provider no-ops gracefully without its key.
- Matches the Champ-Flow runbook: Railway/Vercel deploy, then `0007` migration + `drizzle-kit
  generate`.

---

## 11. Conform-items resolved vs. the patch

- Master schema (TODO #1/#6): resolved — `master_contacts`/`master_organizations` are now **real
  Harbinger-owned tables** with a defined upsert key (email → linkedin → name+domain) and an
  explicit join key (`lakeb2b_id`) for the future sync.
- LakeStream result contract (TODO #2): dropped — owned scrape uses Harbinger's existing
  `WebExtractionService`/`extract.ts`, not the illustrative LakeStream endpoint.
- ZoomInfo enrich path (TODO #3): remains a marked, **off-by-default** optional adapter.
- Drizzle meta (TODO #4): `drizzle-kit generate` run as a build gate.
- Migration numbering: fixed (`0004` → `0007`).

---

## 12. Open items to confirm during the plan

- Exact `covers` defaults per vendor (initial best-guess, product-owner-tunable via
  `PROVIDER_PRIORITY`).
- Whether `mirrorToWorkingTables` should also create `people`/`organizations` rows when none
  exist, or only update existing ones (default: update-or-create behind the flag).
- SP2/SP3 specs authored after SP1 lands and is validated by you.
