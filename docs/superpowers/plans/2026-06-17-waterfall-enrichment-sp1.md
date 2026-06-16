# Waterfall Enrichment Engine + Owned Master DB (SP1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-grounded, owned-first contact/company enrichment waterfall that runs end-to-end on one OpenRouter key, resolves LinkedIn URLs as the universal join key, and accumulates verified results into a Harbinger-owned master DB — with LakeB2B plugged in last.

**Architecture:** Keep the vendor patch's pure core (confidence model, orchestrator skeleton, cache, circuit breaker, budget caps, provenance). Replace every data source with Harbinger's existing OpenRouter-only stack (`WebExtractionService`, `linkedin-service`/`x-service`, SearXNG, `email-tools`) plus a new LLM extraction unit (`extract.ts`). Escalation order is a config-driven provider priority list (price × per-field coverage). On accept, diff-and-upsert into owned `master_contacts`/`master_organizations`. LakeB2B is a pluggable adapter added in the final phase, matched on LinkedIn URL, with recency-based conflict resolution.

**Tech Stack:** Next.js 16, Drizzle 0.28 + postgres.js, Vitest 4, AI SDK v6 + `@openrouter/ai-sdk-provider`, zod, existing Harbinger services.

**Source artifacts:**

- Spec: `docs/superpowers/specs/2026-06-17-waterfall-enrichment-design.md`
- Vendor patch (canonical source for _ported_ files): `champharbinger-waterfall-enrichment.patch` (in conversation). Where a task says "port from patch," copy that file's body verbatim, then apply the listed re-grounding edits. Do NOT copy the patch's paid-provider adapters except as off-by-default optional adapters.

**Conventions (match repo):**

- No em-dashes (U+2014) on added lines; use `-`.
- `import "server-only"` at top of any module touching DB/secrets/scrapers.
- LLM via `getModel`/`getModelSync` + `models.*` from `src/lib/ai/*`. Never call OpenRouter directly.
- Provider keys via `getUserApiKey(keyName, clerkUserId, envFallback)` then env.
- Run tests with `pnpm test` (vitest run). Typecheck `pnpm typecheck`. Lint `pnpm lint`.
- Commit after each task. Work only in worktree `/Users/deep/Apps&Projects/ChampHarbinger-waterfall` on branch `feat/waterfall-enrichment`.

---

## File structure

**New module `src/lib/enrichment/`:**

- `types.ts` — Tier/EmailVerdict/JobStatus enums; Contact/FieldValue/ProviderResult/EnrichmentResult; `minimalIdentifiers`, `identityHash`, `summaryText`. (port + add `ProviderPriorityEntry`)
- `config.ts` — `EnrichmentSettings` from env; thresholds, freshness, budgets, breaker, cache TTLs; `providerPriority` parsing; reseller parsing. (port + add `providerPriority`)
- `confidence.ts` — reliability priors, freshness decay, `buildFieldValue`, `applyEmailGate`, `mergeFields`, `recordConfidence`, `completeness`, **`resolveConflict` (recency-wins)**. (port + add conflict rule)
- `http.ts` — `fetchWithTimeout`, `qs`. (port verbatim)
- `extract.ts` — NEW. LLM extraction from scraped text/profile → FieldValues + firmographics.
- `orchestrator.ts` — waterfall walk driven by the provider priority list. (port + re-ground ordering)
- `cache.ts` — Drizzle TTL cache. (port verbatim, table name unchanged)
- `writeback.ts` — `MasterDBWriter` → owned `master_contacts`/`master_organizations` + log. (re-ground)
- `master-sync.ts` — NEW. `syncWithLakeB2BMaster()` signature + stub (deferred run).
- `engine.ts` — `enrichContact`/`enrichSet`/`getEnrichment`/`listProviders`. (port + re-ground)
- `providers/base.ts` — adapter interface, breaker, registry, `registerDefaultProviders`. (port + re-ground registry)
- `providers/keys.ts` — `resolveProviderKey`. (port verbatim)
- `providers/ownedScrape.ts` — NEW. T1 owned scrape provider using `extract.ts`.
- `providers/linkedinResolver.ts` — NEW. Resolve a LinkedIn URL for a seed (join key).
- `providers/emailGate.ts` — NEW. pattern + MX gate (replaces paid verifiers).
- `providers/lakeb2b.ts` — NEW (FINAL PHASE). LakeB2B API adapter, LinkedIn-match + recency conflict.
- `providers/{proxycurl,pdl,apollo,zoominfo,resellers}.ts` — port as OPTIONAL, off-by-default.
- `__tests__` (colocated `*.test.ts`): `confidence.test.ts`, `orchestrator.test.ts`, `extract.test.ts`, `providerPriority.test.ts`, `emailGate.test.ts`, `writeback.test.ts`, `lakeb2b.test.ts`.

**Modified:**

- `db/schema.ts` — add `enrichment_*` tables + `master_contacts`/`master_organizations`.
- `db/migrations/0007_waterfall_enrichment.sql` — new.
- `src/lib/lakeb2b/client.ts` — add optional `lookupMaster()`/`enrichPerson()` (final phase).
- `src/lib/services/cost-tracker.ts` — add `"enrichment"` to `ServiceName`.
- `src/app/api/v1/enrich/waterfall/route.ts` — new thin route.
- `.env.example` — document new vars.

---

## PHASE 0 — Scaffolding

### Task 0.1: Verify toolchain

- [ ] **Step 1:** Run `pnpm test -- --run src/lib/ai 2>&1 | tail -5` to confirm vitest works. Expected: tests run (pass or "no tests"), no config error.
- [ ] **Step 2:** Confirm `src/__tests__/__mocks__/server-only.ts` exists (it does). Confirm `vitest.config.ts` aliases `@/` to `src/`. Read both. If `server-only` is not aliased to the mock in vitest config, note it; tests importing server-only modules need the alias. Add to `vitest.config.ts` `test.alias`: `{ 'server-only': resolve(__dirname,'src/__tests__/__mocks__/server-only.ts') }` if missing.
- [ ] **Step 3:** Commit any vitest config tweak: `git add -A && git commit -m "test: alias server-only for enrichment unit tests"` (skip if no change).

---

## PHASE 1 — Pure core (types, confidence, http)

### Task 1.1: Domain types

**Files:** Create `src/lib/enrichment/types.ts`

- [ ] **Step 1:** Port `types.ts` from the patch verbatim.
- [ ] **Step 2:** Append the priority-list type:

```ts
/** One provider in the config-driven escalation list (price x coverage). */
export interface ProviderPriorityEntry {
  name: string; // 'owned_scrape' | 'proxycurl' | 'pdl' | 'apollo' | 'zoominfo' | 'reseller:<id>' | 'lakeb2b'
  enabled: boolean;
  costPerCall: number; // USD; owned_scrape ~ 0
  covers: string[]; // canonical fields this provider is good at
  rank: number; // lower = earlier
}
```

- [ ] **Step 3:** `pnpm typecheck 2>&1 | grep enrichment/types || echo OK`. Expected: OK.
- [ ] **Step 4:** Commit: `git add src/lib/enrichment/types.ts && git commit -m "feat(enrichment): domain types + provider priority entry"`.

### Task 1.2: http helpers

**Files:** Create `src/lib/enrichment/http.ts`

- [ ] **Step 1:** Port `http.ts` from the patch verbatim.
- [ ] **Step 2:** Commit: `git add src/lib/enrichment/http.ts && git commit -m "feat(enrichment): fetchWithTimeout + qs helpers"`.

### Task 1.3: Confidence model + conflict resolution (TDD)

**Files:** Create `src/lib/enrichment/confidence.ts`, `src/lib/enrichment/confidence.test.ts`

- [ ] **Step 1 (failing test):** Port the patch's `confidence.test.ts`, then add a conflict test:

```ts
describe("conflict resolution (recency wins)", () => {
  it("prefers the more recently observed value when two sources disagree", () => {
    const older = fv({
      value: "VP Sales",
      confidence: 0.9,
      observedAt: new Date("2024-01-01"),
    });
    const newer = fv({
      value: "Chief Revenue Officer",
      confidence: 0.6,
      observedAt: new Date("2026-06-01"),
    });
    expect(resolveConflict(older, newer).value).toBe("Chief Revenue Officer");
  });
  it("keeps equal-recency higher-confidence value", () => {
    const d = new Date("2026-06-01");
    const a = fv({ value: "A", confidence: 0.4, observedAt: d });
    const b = fv({ value: "B", confidence: 0.8, observedAt: d });
    expect(resolveConflict(a, b).value).toBe("B");
  });
});
```

- [ ] **Step 2:** Run `pnpm test src/lib/enrichment/confidence.test.ts` → FAIL (`resolveConflict` undefined).
- [ ] **Step 3:** Port `confidence.ts` from the patch, then add:

```ts
/**
 * Resolve a genuine value conflict between two observations of the same field.
 * Recency wins (live scrape is stamped now and usually newest); ties break on
 * confidence, then verified. Used by the LakeB2B adapter phase and mergeFields
 * when values differ. Pure.
 */
export function resolveConflict(a: FieldValue, b: FieldValue): FieldValue {
  const at = a.observedAt.getTime();
  const bt = b.observedAt.getTime();
  if (at !== bt) return at > bt ? a : b;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.verified && !b.verified ? a : b;
}
```

Also update `mergeFields`: when both values are present AND differ (`!Object.is(cur.value, inc.value)`), use `resolveConflict(cur, inc)` instead of pure confidence ranking, but preserve the sticky rule (verified existing not overwritten by unverified incoming _only when values are equal/absent_; for genuine conflicts recency governs).

- [ ] **Step 4:** Run `pnpm test src/lib/enrichment/confidence.test.ts` → PASS.
- [ ] **Step 5:** Commit: `git add src/lib/enrichment/confidence.ts src/lib/enrichment/confidence.test.ts && git commit -m "feat(enrichment): confidence model + recency-wins conflict resolution"`.

### Task 1.4: Config + provider priority parsing (TDD)

**Files:** Create `src/lib/enrichment/config.ts`

- [ ] **Step 1:** Port `config.ts` from the patch. Add to `EnrichmentSettings`: `providerPriority: ProviderPriorityEntry[]`.
- [ ] **Step 2:** Add a default priority list + `parseProviderPriority()` (env `PROVIDER_PRIORITY` JSON overrides; bad JSON → defaults). Defaults (owned first, paid by typical price; lakeb2b pinned separately as primary so NOT in this list by default):

```ts
const DEFAULT_PROVIDER_PRIORITY: ProviderPriorityEntry[] = [
  {
    name: "owned_scrape",
    enabled: true,
    costPerCall: 0,
    covers: ["email", "phone", "title", "seniority", "linkedin", "company"],
    rank: 10,
  },
  {
    name: "proxycurl",
    enabled: true,
    costPerCall: 0.03,
    covers: ["title", "seniority", "linkedin", "email", "company"],
    rank: 20,
  },
  {
    name: "pdl",
    enabled: true,
    costPerCall: 0.1,
    covers: ["email", "title", "seniority", "linkedin", "phone", "company"],
    rank: 30,
  },
  {
    name: "apollo",
    enabled: true,
    costPerCall: 0.2,
    covers: ["email", "phone", "title", "seniority", "linkedin", "company"],
    rank: 40,
  },
  {
    name: "zoominfo",
    enabled: true,
    costPerCall: 0.25,
    covers: ["email", "phone", "title", "seniority", "company"],
    rank: 50,
  },
];
```

(`enabled:true` here is intent; an adapter still no-ops without its key, so paid stays off in practice until keys exist.)

- [ ] **Step 3:** Add a unit test `config.test.ts`: bad `PROVIDER_PRIORITY` JSON → defaults; valid JSON → parsed + sorted by rank. Run → PASS.
- [ ] **Step 4:** Commit: `git add src/lib/enrichment/config.ts src/lib/enrichment/config.test.ts && git commit -m "feat(enrichment): settings + configurable provider priority list"`.

---

## PHASE 2 — Provider framework

### Task 2.1: Adapter interface, circuit breaker, registry

**Files:** Create `src/lib/enrichment/providers/base.ts`, `src/lib/enrichment/providers/keys.ts`

- [ ] **Step 1:** Port `providers/keys.ts` verbatim.
- [ ] **Step 2:** Port `providers/base.ts` `ProviderAdapter`, `CircuitBreaker`, `safeFetch`, `ProviderRegistry`. Re-ground `registerDefaultProviders`:
  - Register `OwnedScrapeAdapter` and `EmailGate` providers (Phases 3/5).
  - Register paid adapters ONLY (they self-disable without keys).
  - Do NOT register `lakeb2b` here yet (added in final phase).
  - Add `registry.orderedFor(missingFields, settings)`: returns enabled adapters whose `covers` ∩ `missingFields` ≠ ∅, sorted by the matching `providerPriority` rank.
- [ ] **Step 3:** Keep the existing `base.ts` circuit-breaker unit behavior; add `base.test.ts` covering breaker open/half-open/close (port from patch logic if present, else write 3 small tests). Run → PASS.
- [ ] **Step 4:** Commit: `git add src/lib/enrichment/providers/base.ts src/lib/enrichment/providers/keys.ts src/lib/enrichment/providers/base.test.ts && git commit -m "feat(enrichment): provider adapter base, circuit breaker, priority-ordered registry"`.

---

## PHASE 3 — Owned LLM scrape + extraction (the heart)

### Task 3.1: `extract.ts` (TDD with mocked model)

**Files:** Create `src/lib/enrichment/extract.ts`, `src/lib/enrichment/extract.test.ts`

- [ ] **Step 1 (failing test):**

```ts
import { describe, expect, it, vi } from "vitest";
import { getSettings } from "./config";
import { extractContactFields } from "./extract";

describe("extractContactFields", () => {
  it("maps LLM output to provenance-stamped FieldValues", async () => {
    const fakeModel = {
      generate: vi.fn(async () => ({
        object: {
          email: "jane@acme.com",
          title: "VP Engineering",
          seniority: "VP",
          linkedin: "https://linkedin.com/in/jane",
          phone: null,
          firmographics: { company_name: "Acme", funding_stage: "Series B" },
        },
        usage: {},
      })),
    };
    const res = await extractContactFields(
      {
        scrapedText: "Jane is VP Engineering at Acme...",
        seed: { fullName: "Jane", domain: "acme.com" },
      },
      getSettings(),
      { generateObject: fakeModel.generate },
    );
    expect(res.fields.title.value).toBe("VP Engineering");
    expect(res.fields.title.source).toBe("owned_scrape");
    expect(res.fields.email.verified).toBe(false); // gate runs later
    expect(res.firmographics.funding_stage).toBe("Series B");
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `extract.ts`. A zod schema for `{email,title,seniority,linkedin,phone,firmographics}`; `generateObject` is injected (default: real AI SDK `generateObject` with `getModel(models.classification, clerkUserId)`); map non-empty outputs via `buildFieldValue({provider:"owned_scrape", verified:false})`. Signature:

```ts
export async function extractContactFields(
  input: {
    scrapedText: string;
    seed: {
      fullName?: string | null;
      domain?: string | null;
      company?: string | null;
    };
    profileJson?: unknown;
  },
  settings: EnrichmentSettings,
  deps?: {
    generateObject?: (args: {
      schema: unknown;
      prompt: string;
      model?: unknown;
    }) => Promise<{ object: Record<string, unknown> }>;
  },
): Promise<{
  fields: Record<string, FieldValue>;
  firmographics: Record<string, unknown>;
}>;
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `git add src/lib/enrichment/extract.ts src/lib/enrichment/extract.test.ts && git commit -m "feat(enrichment): LLM extraction from scraped content (extract.ts)"`.

### Task 3.2: `ownedScrape.ts` adapter (TDD with mocked scrape services)

**Files:** Create `src/lib/enrichment/providers/ownedScrape.ts`, `src/lib/enrichment/providers/ownedScrape.test.ts`

- [ ] **Step 1:** Before coding, read the real signatures: `src/lib/services/web-extraction-service.ts` (export + method to fetch a URL → text/links), `src/lib/services/linkedin-service.ts` (`scrapeProfile`), `src/lib/services/x-service.ts`, `src/lib/search/searxng-client.ts` (`searxSearch`), and any `findPeopleOnDomain`/`contact-filter`. Record exact exports in a comment block at top of the adapter.
- [ ] **Step 2 (failing test):** Test that, given a domain and injected fakes for `webExtract` + `extractContactFields`, the adapter returns a successful `ProviderResult` with fields from extraction, `costUsd: 0`, `tier: T1Lakestream`, `provider: "owned_scrape"`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement. Dependencies injected via constructor for testability: `{ webExtract, scrapeLinkedIn, scrapeX, searx, extract }` defaulting to the real services (lazy-imported). Flow per spec §4: domain → web extract (home/team/contact) → if LinkedIn/X URL → profile scrape → SearXNG fallback → `extractContactFields`. `canSupply` = covers ∩ required. `isEnabled` = true (always available; degrades to direct fetch if scrape services unconfigured). `costPerCall = 0`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `git add src/lib/enrichment/providers/ownedScrape.ts src/lib/enrichment/providers/ownedScrape.test.ts && git commit -m "feat(enrichment): owned LLM-scrape provider (T1, OpenRouter only)"`.

### Task 3.3: `linkedinResolver.ts` (TDD) — the join key

**Files:** Create `src/lib/enrichment/providers/linkedinResolver.ts`, `.test.ts`

- [ ] **Step 1:** Read existing LinkedIn-URL backfill logic (commit `9282857`; search `src/lib` for "linkedin" + "web search"/"backfill"). Reuse it.
- [ ] **Step 2 (failing test):** Given a seed with `fullName`+`company` and an injected SearXNG/backfill fake returning a profile URL, `resolveLinkedInUrl(seed)` returns a normalized `https://www.linkedin.com/in/...` URL; given nothing findable → null.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement `resolveLinkedInUrl(seed, deps?)` reusing the backfill/search logic, normalizing the URL. Expose `linkedinUrlMatchesSeed()` helper for later LakeB2B matching.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Wire into `ownedScrape.ts`: when no LinkedIn URL on the seed, call `resolveLinkedInUrl` first and set `fields.linkedin` (verified true once a profile is fetched). Re-run `ownedScrape.test.ts` → PASS.
- [ ] **Step 7:** Commit: `git add src/lib/enrichment/providers/linkedinResolver.ts src/lib/enrichment/providers/linkedinResolver.test.ts src/lib/enrichment/providers/ownedScrape.ts && git commit -m "feat(enrichment): LinkedIn URL resolution as universal join key"`.

---

## PHASE 4 — Email gate (owned, no paid verifiers)

### Task 4.1: `emailGate.ts` (TDD)

**Files:** Create `src/lib/enrichment/providers/emailGate.ts`, `.test.ts`

- [ ] **Step 1:** Read `src/lib/tools/email-tools.ts` (`findEmailForPerson`) + `src/lib/services/email-pattern.ts` (pattern infer) + MX check util. Record exact exports.
- [ ] **Step 2 (failing test):** `gateEmail("jane@acme.com", {domain:"acme.com"}, deps)` with injected fakes:
  - MX present + pattern match → `{verdict: "deliverable"}`.
  - MX present, generic/catch-all domain → `{verdict: "catch_all"}`.
  - No MX → `{verdict: "undeliverable"}`.
  - unknown otherwise.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement `gateEmail(email, ctx, deps?)` returning `EmailVerification` (matches the orchestrator's `EmailVerifyFn` shape `verifyEmail(email, settings, clerkUserId)`). Reuse pattern + MX. Provider name `"owned_email_gate"`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `git add src/lib/enrichment/providers/emailGate.ts src/lib/enrichment/providers/emailGate.test.ts && git commit -m "feat(enrichment): owned email gate (pattern + MX) replacing paid verifiers"`.

---

## PHASE 5 — Orchestrator (priority-list driven)

### Task 5.1: Orchestrator (TDD)

**Files:** Create `src/lib/enrichment/orchestrator.ts`, `src/lib/enrichment/orchestrator.test.ts`

- [ ] **Step 1 (failing tests):** Port the patch's `orchestrator.test.ts` (FakeAdapter pattern), then ADD:

```ts
it("escalates through the provider priority list by rank for missing requested fields", async () => {
  // owned_scrape (rank 10) supplies title only; a fake paid (rank 20) supplies email.
  // required = [email, title]; expect both providers called in rank order, accept after second.
});
it("does not call providers whose covers do not intersect the missing requested fields", async () => {
  /* ... */
});
it("stops escalating once all required fields are filled (no further spend)", async () => {
  /* ... */
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port `orchestrator.ts`; replace the `tiersInOrder()` walk with: compute `missingRequested`; if empty → accept; else iterate `registry.orderedFor(missingRequested, settings)` (priority-ranked), calling each via `callWithCache`, merging, re-gating email, recomputing `missingRequested`; stop on empty/budget/maxTier/exhaust. Keep budget caps, breaker, audit, email gate exactly as patch. The email-verify collaborator is the owned `gateEmail`.
- [ ] **Step 4:** Run → PASS (all orchestrator tests).
- [ ] **Step 5:** Commit: `git add src/lib/enrichment/orchestrator.ts src/lib/enrichment/orchestrator.test.ts && git commit -m "feat(enrichment): priority-list-driven waterfall orchestrator"`.

---

## PHASE 6 — Database (schema + migration)

### Task 6.1: Drizzle tables

**Files:** Modify `db/schema.ts`

- [ ] **Step 1:** Append the 6 `enrichment_*` tables from the patch (verbatim Drizzle blocks).
- [ ] **Step 2:** Append owned-master tables per spec §2.2: `masterContacts` (`master_contacts`) and `masterOrganizations` (`master_organizations`) with columns incl. `lakeb2bId`, `fieldSources jsonb`, `source`, `confidence`, `verified`, `lastVerified`, `lastSyncedAt`, `syncStatus` default `'local_only'`, `clerkOrgId`, timestamps; indexes on email, linkedinUrl, domain, lakeb2bId, `(fullName,domain)`, syncStatus.
- [ ] **Step 3:** `pnpm typecheck` → no schema errors.
- [ ] **Step 4:** Commit: `git add db/schema.ts && git commit -m "feat(db): enrichment_* + owned master_contacts/master_organizations tables"`.

### Task 6.2: Generate migration

**Files:** create via tool

- [ ] **Step 1:** Run `pnpm db:generate`. Expected: a new `db/migrations/0007_*.sql` + updated meta. (If it numbers differently because 0006 exists, accept the generated number.)
- [ ] **Step 2:** Inspect the generated SQL for the 8 tables + indexes + FKs.
- [ ] **Step 3:** Commit: `git add db/migrations && git commit -m "feat(db): generate waterfall enrichment migration"`.

---

## PHASE 7 — Cache, persistence, writeback, master build-up

### Task 7.1: Cache

**Files:** Create `src/lib/enrichment/cache.ts`

- [ ] **Step 1:** Port `cache.ts` verbatim (table `enrichmentCache` unchanged). Confirm `adminDb` + `schema` import paths exist (`@/lib/db/admin`, `@/db`).
- [ ] **Step 2:** Commit: `git add src/lib/enrichment/cache.ts && git commit -m "feat(enrichment): Drizzle TTL provider cache"`.

### Task 7.2: Master writeback + build-up (TDD)

**Files:** Create `src/lib/enrichment/writeback.ts`, `src/lib/enrichment/writeback.test.ts`

- [ ] **Step 1 (failing test):** With an injected fake DB, `MasterDBWriter.writeBack(contact)` given a contact with verified email+title above floor → produces a diff vs existing row and an upsert call into `master_contacts` with `source`, `fieldSources`, `lastVerified`, `syncStatus`, and a `master_writeback_log` insert; nothing-to-write → null.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port `writeback.ts`; re-ground: target Drizzle `schema.masterContacts` (upsert by email → linkedinUrl → name+domain) instead of raw `master_contacts` SQL; populate `fieldSources` from `contact.fields`; set `syncStatus` (`'local_only'`, or `'conflict'` when a conflict was recorded this run via a passed flag); also upsert `masterOrganizations` from firmographics when domain present. Add `mirrorToWorkingTables` (default true) that updates-or-creates `people`/`organizations.enrichmentData` + `email_pattern` for verified email.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `git add src/lib/enrichment/writeback.ts src/lib/enrichment/writeback.test.ts && git commit -m "feat(enrichment): owned master build-up + writeback + working-table mirror"`.

### Task 7.3: master-sync stub

**Files:** Create `src/lib/enrichment/master-sync.ts`

- [ ] **Step 1:** Implement `syncWithLakeB2BMaster(opts?): Promise<{compared:number; updated:number; conflicts:number}>` that, when `LAKEB2B_MASTER_DSN` unset, returns zeros and logs "sync disabled". Real diff deferred. Add `scripts/enrich-sync.ts` calling it; add `"enrich:sync": "tsx scripts/enrich-sync.ts"` to package.json.
- [ ] **Step 2:** Commit: `git add src/lib/enrichment/master-sync.ts scripts/enrich-sync.ts package.json && git commit -m "feat(enrichment): LakeB2B master sync stub (deferred run)"`.

---

## PHASE 8 — Engine wiring + route

### Task 8.1: Engine

**Files:** Create `src/lib/enrichment/engine.ts`; modify `src/lib/services/cost-tracker.ts`

- [ ] **Step 1:** Add `"enrichment"` to `ServiceName` union in cost-tracker.
- [ ] **Step 2:** Port `engine.ts`; re-ground: build registry via re-grounded `registerDefaultProviders`; `verifyEmail` = owned `gateEmail`; on accept run `MasterDBWriter.writeBack`; persist `enrichment_*` rows; cost via `trackUsage({service:"enrichment"})`. Keep `enrichSet` pagination.
- [ ] **Step 3:** `pnpm typecheck` clean for engine.
- [ ] **Step 4:** Commit: `git add src/lib/enrichment/engine.ts src/lib/services/cost-tracker.ts && git commit -m "feat(enrichment): high-level engine wiring + cost tracking"`.

### Task 8.2: v1 route (TDD-lite)

**Files:** Create `src/app/api/v1/enrich/waterfall/route.ts`

- [ ] **Step 1:** Read an existing `src/app/api/v1/enrich/company/route.ts` for the Bearer `chh_` auth pattern + response shape. Mirror it.
- [ ] **Step 2:** Implement `POST` accepting `{name?,company?,domain?,email?,linkedin?,externalRef?,requiredFields?,budgetUsd?,maxTier?}` → calls `enrichContact` with the resolved Clerk/API identity → returns the structured result. Validate body with zod.
- [ ] **Step 3:** Add a Playwright api test (or a vitest route-handler unit) hitting the handler with `LAKEB2B_MOCK=true` + mocked engine deps → 200 + populated record. (If route testing is heavy, assert via an `enrichContact` integration test instead and keep the route thin.)
- [ ] **Step 4:** Commit: `git add src/app/api/v1/enrich/waterfall && git commit -m "feat(api): POST /api/v1/enrich/waterfall"`.

---

## PHASE 9 — Signals data plumbing

### Task 9.1: Ensure enriched record carries signal inputs

**Files:** Modify `src/lib/enrichment/engine.ts` (persistence), confirm schema fields

- [ ] **Step 1:** Confirm enriched `firmographics` + social posts (from owned scrape) are persisted (on `enrichment_contacts.firmographics` and mirrored to `people.enrichmentData`) so existing signals (intent, funding, new-hires, job-changes, active-audience) can read them. Add fields to the extract schema if missing: `recentPosts`, `fundingStage`, `recentRoleChange`.
- [ ] **Step 2:** Add an integration test asserting `enrichContact` output `firmographics`/`enrichmentData` includes funding + recent-post inputs from a mocked scrape.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "feat(enrichment): persist social/funding/job-change inputs for signals"`.

---

## PHASE 10 — End-to-end (no LakeB2B yet)

### Task 10.1: Integration test — owned-only, one OpenRouter key

**Files:** Create `src/lib/enrichment/engine.integration.test.ts`

- [ ] **Step 1:** With `LAKEB2B_MOCK=true`, scrape services + `generateObject` mocked to return a realistic person from a domain, run `enrichContact({domain, name})` → assert: requested fields filled from owned scrape only, `tiersAttempted` shows no paid provider, `totalCostUsd === 0`, a `master_contacts` upsert occurred (fake DB), a resolved/!null `linkedin`.
- [ ] **Step 2:** Run → PASS. Then `pnpm test` (full enrichment suite) → all green.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "test(enrichment): owned-only end-to-end integration (one OpenRouter key)"`.

### Task 10.2: Build gates

- [ ] **Step 1:** `pnpm typecheck` → clean. Fix any errors.
- [ ] **Step 2:** `pnpm lint` → clean (fix em-dashes/unused).
- [ ] **Step 3:** `pnpm test` → all green.
- [ ] **Step 4:** `pnpm build 2>&1 | tail -20` → succeeds (the engine is in the Next build). Fix server-only/import issues.
- [ ] **Step 5:** Commit: `git commit -am "chore(enrichment): pass typecheck/lint/test/build gates"` (if changes).

---

## PHASE 11 — LakeB2B adapter (FINAL — plugged in last)

### Task 11.1: LakeB2B adapter w/ LinkedIn match + recency conflict (TDD)

**Files:** Create `src/lib/enrichment/providers/lakeb2b.ts`, `src/lib/enrichment/providers/lakeb2b.test.ts`

- [ ] **Step 1 (failing test):**

```ts
it("matches by LinkedIn URL first and returns contact details", async () => {
  // fake LakeB2B client.searchPeople({linkedin_url}) -> a person; adapter maps to fields.
});
it("when LakeB2B title conflicts with a newer live-scrape title, the newer value wins", async () => {
  // contact.fields.title from owned_scrape stamped now; LakeB2B title older.
  // After merge, title === live value; provenance retains the LakeB2B value; syncStatus conflict flag set.
});
it("no-ops gracefully when LakeB2B is unconfigured (mock off)", async () => {
  /* returns emptyResult */
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `LakeB2BAdapter` using `getLakeB2BClient()`; lookup order: `linkedin_url` → email → name+domain; map person → FieldValues with `provider:"lakeb2b"`, `observedAt` = the record's last-verified/now-minus-default, `verified:true` for owned-master-grade fields. Mark conflicts: when merging, if a field already present from `owned_scrape`/live differs, use `resolveConflict` (recency wins) and set a `conflict` flag the engine passes to writeback.
- [ ] **Step 4:** Register `LakeB2BAdapter` in `registerDefaultProviders` **and pin it as primary** in the orchestrator: run LakeB2B (when enabled) immediately after the owned-master read and before the priority-list escalation. Add `lakeb2b` to the priority list semantics as "pinned primary," not a ranked entry.
- [ ] **Step 5:** Run lakeb2b tests + full orchestrator suite → PASS.
- [ ] **Step 6:** Extend `src/lib/lakeb2b/client.ts` with `lookupMaster()` + `enrichPerson()` (lazy-import engine), preserving the existing exports.
- [ ] **Step 7:** Commit: `git add -A && git commit -m "feat(enrichment): LakeB2B adapter (LinkedIn-match, recency conflict resolution) - final plug-in"`.

### Task 11.2: Conflict-aware master + final e2e

**Files:** verify `writeback.ts`, add integration test

- [ ] **Step 1:** Integration test: owned scrape + LakeB2B both on (fakes), conflicting `title`, newer live value → master row stores live value, `field_sources.title` shows both, `sync_status='conflict'`. PASS.
- [ ] **Step 2:** `.env.example` + spec "open items" updated; document `PROVIDER_PRIORITY`, master vars, that LakeB2B is primary-when-configured.
- [ ] **Step 3:** Re-run all gates (typecheck/lint/test/build). Commit.

---

## PHASE 12 — Final verification + presentation

### Task 12.1: Full suite + manual e2e script

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- [ ] **Step 2:** Create `scripts/enrich-demo.ts`: enrich 2-3 sample seeds (a person w/ name+company; a company → roles) printing the resolved LinkedIn URLs, fields, sources, confidence, and master rows. Run it against a dev DB with only `OPENROUTER_API_KEY` (+ scrape URLs if available). Capture output.
- [ ] **Step 3:** Write `docs/superpowers/plans/SP1-RESULTS.md` summarizing what works, the demo output, env needed, and deploy steps (migration `0007`, `drizzle-kit generate`). Commit.
- [ ] **Step 4:** Present to product owner for final testing (do not merge to main; leave on `feat/waterfall-enrichment`).

---

## Self-review notes

- Spec coverage: §1-12 + 11b mapped to Phases 1-11 (engine core→1/2/5, owned scrape+extract+LinkedIn→3, gate→4, DB+master→6/7, engine/route→8, signals→9, LakeB2B+conflict→11). ✓
- LakeB2B-last directive: enforced (Phase 11 is final; Phases 1-10 prove owned-only e2e). ✓
- Recency conflict resolution: `resolveConflict` (Task 1.3), applied in LakeB2B merge (Task 11.1), surfaced in master (Task 11.2). ✓
- One-OpenRouter-key e2e: Task 10.1 asserts zero paid cost. ✓
- Deployment: migration + gates in Phases 6/10/11/12. ✓
- Ported files reference the patch as canonical source (concrete artifact); novel files have full code/signatures here.
