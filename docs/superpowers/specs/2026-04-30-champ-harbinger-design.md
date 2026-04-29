# ChampHarbinger — Design Spec

*Date: 2026-04-30*
*Status: Approved (pending user spec review)*
*Source project: [jay-sahnan/signal](https://github.com/jay-sahnan/signal)*

---

## Overview

ChampHarbinger is a Champions Group rebrand and rearchitecture of the open-source Signal sales-intelligence platform. It detects buying-intent signals on the web (hiring changes, funding, news, review sentiment), enriches contacts and companies, drafts personalized outreach, and runs multi-step email sequences from a chat-first workspace.

The name *Harbinger* — "a signal that something is coming" — names the product concept directly: ChampHarbinger surfaces buying intent before it becomes a deal.

This spec covers the v1 build: a complete rebrand of Signal into ChampHarbinger, replacement of Supabase with vanilla Postgres, replacement of Anthropic-direct with OpenRouter, and addition of monitoring infrastructure (Sentry + Prometheus). All of this lands in a single coordinated push using parallel agents.

## Goals

- Stand up a fully-branded ChampHarbinger app running locally on Postgres with Clerk auth and OpenRouter LLM access.
- Replace Supabase entirely with vanilla Postgres + Drizzle ORM, removing the multi-tenant RLS layer in favor of application-layer scoping by Clerk identity.
- Move LLM access from direct Anthropic to OpenRouter so model choice is configurable from day one.
- Re-skin the entire UI to Champions Group brand (orange #F26722 + white + Ink, Inter typography, shadcn/ui re-themed).
- Eliminate every "Signal" reference in the codebase — UI, copy, comments, env vars, package metadata, license headers.
- Wire Sentry (errors) and Prometheus (metrics) for production observability.
- Polish the marketing/landing surface for launch.

## Non-Goals (v1)

- Custom-designed harbinger logo (placeholder wordmark in v1; designed asset later)
- ChampMail / Emalia integration for outbound email — v1 ships with a stub email provider; sequence sending is disabled until ChampMail is wired
- Localization beyond English
- Multi-tenant SaaS hardening beyond what Clerk-based scoping provides — we remain in single-tenant deployment posture
- Migration of any existing Signal data — fresh schema, fresh database
- Production deployment automation — local Docker Compose only in v1; production hosting decided later

## Architecture

### Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript | Unchanged from Signal |
| Styling | Tailwind CSS 4 + shadcn/ui | Re-themed to Champions Group |
| Auth | Clerk | Unchanged from Signal |
| Database | Postgres 16 (vanilla) | Replaces Supabase |
| ORM | Drizzle ORM + drizzle-kit | Replaces `@supabase/supabase-js` |
| DB driver | postgres.js | Lightweight, well-paired with Drizzle |
| LLM | OpenRouter via Vercel AI SDK | Replaces direct Anthropic; default model configurable |
| Web automation (optional) | Browserbase + Stagehand | Kept |
| Job scheduling (optional) | QStash | Kept; flagged for further research |
| Data enrichment (optional) | Exa, Apify, Lake B2B / LakeStream | Lake B2B/LakeStream as Champions-internal provider |
| Email (optional) | Stub interface only in v1 | ChampMail integration planned post-v1 |
| Error monitoring | Sentry | New |
| Metrics | Prometheus (`/metrics` endpoint) | New |
| Testing | Vitest + Playwright | Unchanged |
| Tooling | pnpm + Husky | Unchanged |
| Deployment (v1) | Docker Compose (local) | Production target TBD |

### Components

- **Web app** — Next.js single codebase; UI, route handlers, server actions
- **Postgres** — schema defined in Drizzle, migrations managed by `drizzle-kit`, runs in Docker locally
- **Auth shim** (`lib/auth.ts`) — wraps Clerk's `auth()` and exposes `{ userId, orgId }` for the DB scope helper
- **Scoped DB** (`lib/db/scoped.ts`) — wraps Drizzle's query builder so every query auto-injects `WHERE clerk_user_id = ?` (or `clerk_org_id`); prevents accidental unscoped queries
- **AI provider** (`lib/ai/provider.ts`) — thin wrapper over `@openrouter/ai-sdk-provider`; default model configured via env (`HARBINGER_DEFAULT_MODEL`)
- **Email provider stub** (`lib/email/provider.ts`) — interface plus a no-op implementation; if no provider is configured, sequence-sending paths return a "disabled" error instead of crashing
- **Monitoring** — Sentry SDK initialized in `instrumentation.ts`; `/api/metrics` route exposes Prometheus format

### Data flow (high-level)

1. User signs in through Clerk middleware
2. Server action / route handler calls `getDb()` → returns a scoped Drizzle instance bound to the current `{ userId, orgId }`
3. All queries through the scoped instance auto-filter by tenant
4. AI calls go through `lib/ai/provider.ts` → OpenRouter → selected model
5. Optional integrations (Browserbase, QStash, Exa, etc.) check for their env vars at startup; if missing, the dependent feature is gracefully disabled

## Database Design

### Schema strategy

- Define schema fresh in TypeScript at `db/schema.ts` using Drizzle's column helpers
- Tables that referenced `auth.users(id)` in Signal now reference a local `users` table where `id` is the Clerk user ID stored as `text`
- Tables gain an explicit `clerk_user_id` (and `clerk_org_id` where applicable) column for tenant scoping
- Standard timestamp columns (`created_at`, `updated_at`) on every table
- Single consolidated initial migration generated by `drizzle-kit generate`

### Tenant isolation

- **No RLS.** All scoping enforced at the application layer.
- `getDb()` returns a Drizzle instance whose `select`, `insert`, `update`, `delete` are wrapped to inject the current tenant filter.
- Direct unscoped DB access available only via `getDbAdmin()` for system tasks (migrations, cron); never reachable from request handlers.
- Lint rule (or code review checklist) prohibits importing the raw Drizzle instance from anywhere except `lib/db/scoped.ts`.

### Local dev

- `postgres:16` service in `docker-compose.yml`
- Database name: `champ_harbinger`
- Connection string in `.env.example`: `DATABASE_URL=postgres://harbinger:harbinger@localhost:5432/champ_harbinger`
- `pnpm db:push` runs Drizzle migrations
- `pnpm db:studio` opens Drizzle Studio for inspection

### Production

- Any standard Postgres host (Neon, Render, RDS, self-managed)
- No vendor lock — connection string is the only thing that changes between envs
- Backup/restore via standard `pg_dump` / `pg_restore`

### Explicitly not built

- Postgres extensions specific to Supabase (`pgsodium`, `pg_graphql`)
- Supabase Realtime equivalent (Signal does not appear to use it)
- Supabase Storage equivalent (no file uploads in v1)

## Branding System

### Naming

| Context | Old (Signal) | New (ChampHarbinger) |
|---|---|---|
| Product name | Signal | ChampHarbinger |
| Tagline | (Signal's existing) | "Empowering Innovation. Building Resilience." (Champions Group umbrella) — final product tagline drafted during marketing polish |
| Package name | `signal` | `champ-harbinger` |
| Repo / directory | `signal/` | `champ-harbinger/` (lives at `/Users/deep/Apps&Projects/ChampHarbinger/`) |
| Env var prefix | `SIGNAL_*` | `HARBINGER_*` |
| Public env var prefix | `NEXT_PUBLIC_SIGNAL_*` | `NEXT_PUBLIC_HARBINGER_*` |
| Database name | `signal` | `champ_harbinger` |
| Email "from" name | Signal | ChampHarbinger |
| Comments referencing Signal | "Signal does X" | "ChampHarbinger does X" |
| License headers | jay-sahnan / Signal | Champions Group / ChampHarbinger |
| Cookies / localStorage keys | `signal_*` | `harbinger_*` |
| GitHub URLs in docs | github.com/jay-sahnan/signal | TBD placeholder (filled in when repo is created) |

### Color tokens

Tailwind config + CSS custom properties. Mirrors Champions Group brand guide exactly:

```ts
champions: {
  orange:        '#F26722',  // primary, CTAs, headlines
  'deep-orange': '#D94F0A',  // hover, pressed states
  'bright-orange': '#FF8544', // accents on dark
  'soft-peach':  '#FFF4EC',  // section bg, cards
  'warm-tint':   '#FFE8D6',  // badges, selected
  ink:           '#1A1A1A',  // body text
  'ink-soft':    '#2E2E2E',  // subheadings
  'warm-gray':   '#6B6B6B',  // captions
  'border':      '#E5E7EB',  // dividers
  'off-white':   '#FAFAFA',  // layered cards
  'light-gray':  '#F5F5F5',  // disabled
}
```

Plus gradient utilities: `champions-gradient`, `warm-sunset`, `peach-wash`, `orange-fade`.

### Typography

- Inter (web) loaded via `next/font/google`
- shadcn/ui components retargeted to Inter
- Heading scale per brand guide: H1 32px bold Ink, H2 26px bold Ink-soft, body 14–16px Ink, captions 11–12px Warm Gray
- CTAs/buttons: SemiBold, sentence case, `letter-spacing: 0.01em`

### shadcn/ui re-skin

- `components.json` theme remapped: `--primary` → Champions orange
- Buttons: primary (orange/white, hover deep-orange), secondary (white with orange border, hover peach), tertiary (ghost with peach hover)
- Inputs, cards, dialogs, badges all retargeted to brand palette
- Contrast rules enforced (no orange text on peach, no light gray on white, etc.)

### Logo / favicon

- Placeholder ChampHarbinger wordmark SVG (orange wordmark + simple harbinger glyph)
- Replace `favicon.ico`, `apple-touch-icon.png`, OG image
- Custom-designed logo deferred to post-v1

### Copy

- README rewritten top-to-bottom in Champions Group voice
- Marketing/landing copy in `app/(marketing)/` rewritten for launch (hero, feature blurbs, CTAs)
- In-app empty states, error messages, tooltips rewritten to brand voice (authoritative, warm, visionary, empowering, precise)
- Email templates rebranded (sender name, signatures, footers)
- License header swapped to Champions Group
- Privacy / terms links updated to placeholders pending real URLs

## LLM Provider

- Direct `@ai-sdk/anthropic` usage replaced with `@openrouter/ai-sdk-provider`
- Vercel AI SDK retained as the abstraction layer
- Default model configurable via `HARBINGER_DEFAULT_MODEL` env var (e.g., `anthropic/claude-sonnet-4.6`)
- Model can be overridden per-call where needed (e.g., faster/cheaper model for classification, smarter model for outreach drafting)
- Required env vars: `OPENROUTER_API_KEY` (auth), `HARBINGER_DEFAULT_MODEL` (default model selection)

## Optional Integrations

| Integration | Status | Notes |
|---|---|---|
| Browserbase + Stagehand | Included, optional | Web automation; gracefully disables if API key missing |
| QStash | Included, optional | Job scheduling; flagged for further research before heavy use |
| Exa | Included, optional | Web search / scraping for enrichment |
| Apify | Included, optional | Advanced scraping |
| Lake B2B / LakeStream | Slot reserved | Champions-internal data provider; integration to be wired |
| AgentMail | **Removed** | Replaced with stub interface; ChampMail integration planned later |
| Email (any provider) | Stubbed | Interface defined; no provider in v1 → sequence-sending disabled |

All optional integrations follow the same pattern: check env vars at module init; if missing, expose a no-op or "feature disabled" implementation. The app boots and runs without any optional integration configured.

## Monitoring

### Sentry

- `@sentry/nextjs` integrated via `instrumentation.ts`
- DSN configured via `SENTRY_DSN` env var
- Captures unhandled errors, route handler exceptions, server action failures
- Source maps uploaded during production builds

### Prometheus

- `/api/metrics` route exposes Prometheus-format metrics
- Default metrics: process metrics, HTTP request count/duration, DB query count/duration, AI call count/duration/cost
- Metrics library: `prom-client`
- Enabled by default; access can be IP-restricted via env var if needed

## Parallel Execution Strategy

### Pre-step (sequential, single agent)

1. The empty `Signal/` working directory is left alone; new work happens in `/Users/deep/Apps&Projects/ChampHarbinger/` (already created with this spec)
2. Download Signal source as a tarball (not `git clone` — keeps our git history clean), extract into the new repo on top of this spec
3. Stage `package.json` skeleton: name `champ-harbinger`, dependencies updated (Drizzle, postgres.js, OpenRouter, Sentry, prom-client added; Supabase, AgentMail removed)
4. Create `.env.example` with new env var prefixes
5. Create `docker-compose.yml` with Postgres 16 + the app
6. Commit the baseline. **All parallel agents fork from this commit using git worktrees.**

### Parallel streams (each in its own git worktree)

| Stream | Owner files | Scope |
|---|---|---|
| **A — DB layer** | `db/`, `lib/db/`, all callsites of `@supabase/supabase-js`, drizzle config | Define Drizzle schema; write `scopedDb()` helper; replace every Supabase call with Drizzle equivalent; generate initial migration |
| **B — Branding sweep** | UI strings, comments, copy, README, license headers, `tailwind.config.*`, `components.json`, color tokens, `app/globals.css`, logo/favicon assets | Mass find/replace Signal → ChampHarbinger; install Champions Group color tokens; re-skin shadcn theme; swap favicon/logo placeholders |
| **C — LLM provider** | `lib/ai/`, `lib/anthropic.ts` (renamed/repurposed), AI SDK call sites, env var schema | Swap to `@openrouter/ai-sdk-provider`; configure default model; expose model selection |
| **D — Integrations + monitoring** | `lib/email/`, `lib/monitoring/`, Sentry config, `/api/metrics`, AgentMail removal | Stub email provider; wire Sentry; expose Prometheus metrics |
| **E — Marketing/landing** | `app/(marketing)/` and landing route files only | Rewrite hero, feature sections, voice/tone for Champions Group launch |

### Conflict avoidance

- Every stream owns disjoint paths (verified by file listing in the implementation plan)
- Shared files (`package.json`, `.env.example`) handled in pre-step, not by parallel agents
- New deps required by a parallel agent are recorded in a `DEPS_TO_MERGE.md` note in that worktree, not added to `package.json` directly
- Any cross-stream interface change requires updating this spec first

### Post-merge integration step (sequential, single agent)

1. Merge each stream's worktree back to main in order: A → B → C → D → E
2. Resolve any straggler conflicts
3. Apply all `DEPS_TO_MERGE.md` notes to `package.json`, run `pnpm install`
4. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
5. Boot via `docker-compose up`, verify the app loads with new branding and new DB

## Verification

The build is "done" only when all of the following pass:

- App boots locally with `docker-compose up`
- Postgres reachable; Drizzle migration applied; schema visible in `pnpm db:studio`
- Login via Clerk works end-to-end
- Can create a basic record (e.g., a campaign) via the UI; record visible in Postgres
- LLM call works through OpenRouter (test with a cheap model like `openai/gpt-4o-mini`)
- `grep -ri 'signal' --exclude-dir=node_modules --exclude-dir=.git .` reviewed manually. Distinguish:
  - **Must be replaced:** "Signal" as the product name in copy, comments, identifiers, package names, types, env vars, license headers
  - **Allowed to remain:** the English word "signal" used in product copy (ChampHarbinger detects *buying signals*), Web standards (`AbortSignal`), and any technical terms unrelated to the old product brand
- `grep -ri '@supabase' --exclude-dir=node_modules --exclude-dir=.git .` returns zero hits
- Sentry receives a test error (deliberate `throw new Error('sentry-test')` in a test route)
- `/api/metrics` endpoint returns Prometheus output
- All existing Signal tests pass after rebrand (or are updated/removed if they tested removed features)
- Lint and typecheck clean

## Open Questions / Future Work

- **ChampMail integration** — when ChampMail is ready, wire it into the email provider stub
- **LakeStream / Lake B2B integration** — connect data enrichment paths to internal sources
- **Production hosting** — choose between Vercel, self-hosted Docker, or another platform
- **Custom logo design** — replace placeholder wordmark
- **Marketing site polish** — final hero copy, feature tour, customer logos (if applicable)
- **Lake B2B contact-database direct integration** — for native contact lookups
- **Brand voice review** — final copy pass with Champions Group marketing
