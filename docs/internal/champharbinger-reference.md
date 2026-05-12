# ChampHarbinger — Internal Reference

A Champions Group product. This document is the single internal reference for the team: what the system is, how to use it, the full stack, branding audit, and how it positions against Champ IQ and Exa websets.

---

## 1. What ChampHarbinger Is

**One sentence:** An AI-powered B2B sales prospecting platform that detects buying signals on the web, enriches prospects, and executes personalized multi-step email campaigns — all driven by a central chat interface.

**The name:** _Harbinger_ — "a signal that something is coming." ChampHarbinger surfaces buying intent before it becomes a deal.

**License:** AGPL-3.0. Any public deployment of a modified version must be open-sourced.

**Core loop:**

```
Describe ICP in chat
    → AI finds matching companies
    → System enriches companies + contacts (LinkedIn, GitHub, Exa, Apify, LakeB2B)
    → Buying signals monitor for intent (hiring, funding, exec changes, product launches)
    → Outreach sequences send personalized emails and track opens / clicks / replies
```

**What it is NOT:**

- A general-purpose CRM (no deal pipeline, no deal stage tracking)
- A mass email blaster (designed for high-personalization, signal-triggered outreach)
- A data provider (it consumes data from Exa, Apify, LakeB2B; it doesn't produce it)

---

## 2. How It Fits in the Champ Suite

| Product            | Layer        | Role                                                |
| ------------------ | ------------ | --------------------------------------------------- |
| **ChampHarbinger** | Action       | Detects signals, runs campaigns, sends outreach     |
| **Champ IQ**       | Intelligence | Company intelligence + enrichment aggregator        |
| **ChampMail**      | Delivery     | Email sending, delivery, and tracking               |
| **ChampOracle**    | Strategy     | Positioning, ICP strategy, competitive intelligence |
| **ChampQuest**     | Research     | B2B data and prospect research                      |
| **ChampTrack**     | Analytics    | Campaign attribution and performance                |
| **ChampUTM**       | Links        | URL parameter management                            |
| **ChampVideo**     | Content      | Video personalization for outreach                  |
| **ChampVox**       | Voice        | Voice and message personalization                   |

ChampHarbinger is the **command center** of the Champ suite — it initiates research, consumes enrichment, and drives outreach. Downstream analytics feed into ChampTrack. Email delivery goes through ChampMail.

**Current gap:** ChampHarbinger enriches directly (bypassing Champ IQ). If Champ IQ is live, routing enrichment through it would reduce API sprawl and centralize data quality decisions.

---

## 3. How It Compares: ChampHarbinger vs Champ IQ vs Exa Websets

These three are often confused. They operate at different layers of the same pipeline.

|                                | ChampHarbinger                                               | Champ IQ                                                            | Exa Websets                                                        |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Owner**                      | Champions Group                                              | Champions Group                                                     | Exa (exa.ai) — third party                                         |
| **Type**                       | Prospecting + outreach platform                              | Company intelligence aggregator                                     | Curated web page sets by topic                                     |
| **Layer**                      | Action layer                                                 | Data/enrichment layer                                               | Raw search/retrieval layer                                         |
| **What it does**               | Detects intent signals, runs email campaigns, tracks replies | Aggregates and enriches company/contact data into a clean API       | Indexes and retrieves relevant web pages on a topic, on demand     |
| **How ChampHarbinger uses it** | —                                                            | Ideal future enrichment source (currently direct APIs used instead) | Queried via `exa-js` SDK for semantic web search during enrichment |
| **Key differentiator**         | Workflow execution + outreach                                | Pure data intelligence                                              | Search infrastructure                                              |

**Plain English:**

- Exa websets = "give me all web pages about topic X, curated and ranked"
- Champ IQ = "give me everything we know about company Y"
- ChampHarbinger = "find companies showing signal X, research them via Exa + Champ IQ, send them email sequence Z"

---

## 4. Branding Audit

### Consistent (correct)

| Location                                | Value                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Page `<title>` (`layout.tsx:18`)        | `"ChampHarbinger"`                                                             |
| Meta description                        | `"Detect buying signals before they become deals. A Champions Group product."` |
| Marketing hero, footer, header          | "ChampHarbinger" + "A Champions Group product" throughout                      |
| Sidebar feedback link                   | `hello@championsgroup.com`                                                     |
| AI system prompt (`system-prompt.ts:1`) | `"You are ChampHarbinger..."`                                                  |
| npm package name                        | `champ-harbinger` — npm requires lowercase/hyphen; not a bug                   |
| Postgres DB name                        | `champ_harbinger` — postgres naming convention; not a bug                      |
| Env var prefix                          | `HARBINGER_` used consistently for all app-level vars                          |
| Copyright                               | `© {year} Champions Group. All rights reserved.`                               |
| License footer                          | AGPL-3.0 link                                                                  |
| Champions Group footer links            | `championsgroup.io`, `lakeb2b.com`, `ampliz.com`                               |

### Inconsistencies to Address

**1. `docs/setup.md` — still references old product name "Signal"**

This is the most significant branding break. The setup doc was not updated when the project was renamed.

Specific instances:

- Line 29: `git clone https://github.com/jay-sahnan/signal.git`
- Line 30: `cd signal`
- Line 93: "Signal uses [Clerk] for sign-in/sign-up."

**Action:** Update `docs/setup.md` to use ChampHarbinger and the correct repo URL.

**2. `docs/setup.md` — uses `ANTHROPIC_API_KEY` but the app uses `OPENROUTER_API_KEY`**

Setup doc (line 101–103) tells users to get an Anthropic key and set `ANTHROPIC_API_KEY`. The actual `.env.example` and `package.json` use OpenRouter (`OPENROUTER_API_KEY` + `@openrouter/ai-sdk-provider`).

**Action:** Fix the setup doc to reference OpenRouter.

**3. `docs/setup.md` — has full Supabase setup instructions but the app doesn't use Supabase client**

The setup doc walks through `supabase start`, `supabase db reset`, and references env vars like `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — none of which exist in `.env.example`. The app uses Drizzle ORM + raw `postgres` driver (no `@supabase/supabase-js` in `package.json`).

**Action:** Rewrite `docs/setup.md` to use `docker compose up -d postgres` + `pnpm db:migrate` (matching `README.md`).

**4. `docs/setup.md` — "AgentMail" but current code uses "ChampMail"**

Setup doc (optional services table) lists "AgentMail" as the email service. `.env.example` and `README.md` both say "ChampMail."

**Action:** Update to "ChampMail."

**5. `CHAMPMAIL_API_KEY` prefix vs `HARBINGER_` convention**

ChampMail env vars use the `CHAMPMAIL_` prefix instead of `HARBINGER_`. This is intentional (ChampMail is a sibling product, not an internal setting), but the `.env.example` doesn't explain the distinction. The comment reads "v1 ships with a stub email provider" — no explanation of why the prefix differs.

**Action:** Add a comment to `.env.example` clarifying that `CHAMPMAIL_` is correct because ChampMail is a separate product.

**6. Marketing copy "12 Champions Group companies" — verify accuracy**

`hero.tsx:19`: "Powered by 12 Champions Group companies." The footer only lists 2 (Lake B2B, Ampliz). If the Champ suite has 9 products listed in `README.md` plus the parent group, "12" may refer to the full portfolio of group companies rather than Champ products.

**Action:** Confirm the number is accurate with the team before launch.

---

## 5. User Guide: Walking Through ChampHarbinger

### Prerequisites

| Requirement        | Detail                            |
| ------------------ | --------------------------------- |
| Node               | 20+                               |
| pnpm               | 10.x (`corepack enable`)          |
| Docker             | 24+ (for local Postgres)          |
| Clerk account      | Free tier (10k MAU)               |
| OpenRouter API key | Required; starts with `sk-or-v1-` |

**Setup (one time):**

```bash
git clone <repo-url> champ-harbinger
cd champ-harbinger
cp .env.example .env.local
# Fill in CLERK_*, OPENROUTER_API_KEY at minimum
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
# → http://localhost:3000
```

Clerk runs in Keyless mode if credentials are blank — useful for first run, but enrichment and email features are gated.

---

### The 7-Step Workflow

#### Step 1 — Dashboard (first landing)

After login, you land at `/dashboard`. This is your campaign command center:

- **Metrics strip:** total leads, emails sent, open rate, reply rate, bounce rate
- **Time-series chart:** outreach volume over 30 / 90 / 180 days (select via range toggle)
- **Campaign table:** per-campaign breakdown with open and reply rates

No data yet? That's normal — campaigns are created via Chat.

---

#### Step 2 — Start a Campaign via Chat

Navigate to `/chat` and open a new conversation. Describe your ICP:

> "Find SaaS companies in Austin with 50–200 employees that are hiring a VP of Sales."

The AI will:

1. Ask clarifying questions (industry, geography, size, target titles, pain points, offering)
2. Ask which existing sender profile to use — or create a new one
3. Search via `discoverCompanies` (directories first) and `searchCompanies` (semantic)
4. Present a table of matching companies with relevance reasoning

**Tip:** The AI processes companies in batches of 3–5 and checkpoints after each batch. You can say "keep going" or "stop here" at each checkpoint.

---

#### Step 3 — Enrich + Qualify

For each company batch, the AI automatically runs the full pipeline:

1. `enrichCompany` — fetches website + 3 Exa searches (product, funding, team)
2. `scrapeJobListings` — Browserbase + Stagehand navigates the careers page and extracts job listings
3. **ICP scoring** — scores 1–10 based on fit, hiring signals, and timing
4. `scoreCompany` — persists score and reasoning
5. If qualified (≥6): `findContacts` → `enrichContact` → `scoreContact`

You'll get a summary table after each batch: companies scored, contacts found, top priorities.

---

#### Step 4 — Configure Signals

Navigate to `/signals`. Signals are automated intent detectors the AI will monitor for this campaign.

**Built-in categories:**

- Hiring (headcount surge, specific role hires)
- Funding (seed through Series C+)
- Executive (new CxO, VP hire)
- Product (launches, changelog entries)
- Engagement (review spikes, social activity)
- Community (YC batch, accelerator mentions)

**To enable signals for a campaign:**

1. Select the campaign from the dropdown
2. Toggle signals on/off per campaign
3. Or ask the AI in Chat: "Set up signals for this campaign" — it will recommend based on your ICP

**To create a custom signal:**

> "Create a signal for companies that published 5+ blog posts about AI in the last month."

The AI calls `getSignalAuthoringGuide` first, then walks you through drafting, testing, and saving the signal.

**Community signals:** Good custom signals can be published to the community library for other workspaces to discover.

---

#### Step 5 — Set Up Outreach Sequences

In Chat, ask the AI to draft a sequence:

> "Set up a 3-step outreach sequence for the qualified companies in this campaign."

The AI:

1. Calls `createSequence` with steps, timing, and trigger signal
2. Calls `draftEmailsForSequence` — a server-side fan-out that composes all drafts in parallel
3. Returns draft counts (drafted / skipped / failed) and a link to `/outreach/review`

**Review UI (`/outreach/review`):** This is where you approve, edit, or reject individual email drafts before they send. Emails do not send from Chat — they only send after explicit approval in the review UI.

**Email skills:** The AI uses your email skills (voice/style rules) when composing. Set them up with: "Save a rule: always keep cold emails under 5 sentences."

---

#### Step 6 — Monitor

Back on `/dashboard`:

- Metric strip updates as emails go out and webhooks arrive from ChampMail
- Campaign table shows per-campaign open/reply rates
- Click into a campaign to see individual outreach status (sent, opened, clicked, replied, bounced)

**Reply tracking:** ChampMail sends webhook events (via Svix) when emails are opened, clicked, or replied to. The `outreach` table stores the full timeline per email.

---

#### Step 7 — Iterate

- **Edit a signal:** in Chat, "Edit the hiring signal — also flag companies posting DevOps roles"
- **Adjust a sequence:** in Chat, "Make step 2 shorter and reference the funding news"
- **New campaign:** start a new Chat conversation and repeat
- **Track over time:** ask the AI to set up tracking for companies that aren't ready now but show potential

**Shared knowledge base:** Companies and contacts are global across campaigns. If you enriched Acme Corp in Campaign A, Campaign B gets that enrichment immediately (if < 7 days old). Campaign-specific scores are separate.

---

## 6. Stack Analysis

### Full Stack

| Layer                | Technology                              | Notes                                         |
| -------------------- | --------------------------------------- | --------------------------------------------- |
| Framework            | Next.js 16 (App Router)                 | React 19, TypeScript                          |
| Styling              | Tailwind CSS v4 + Base UI               | Base UI for accessible primitives (not Radix) |
| Database             | PostgreSQL 16 + Drizzle ORM             | `postgres` driver, no Supabase client         |
| Auth + Multi-tenancy | Clerk                                   | Workspace scoping via Clerk orgs              |
| LLM Gateway          | OpenRouter via Vercel AI SDK v6         | Any model; defaults to Claude Sonnet 4.6      |
| Web Search           | Exa API (`exa-js` v2.8)                 | Neural search for enrichment and research     |
| Web Scraping         | Apify                                   | LinkedIn + X scraping                         |
| Browser Automation   | Browserbase + Stagehand                 | Careers pages, JS-heavy sites                 |
| Email Sending        | ChampMail (stub in v1)                  | AgentMail integration planned                 |
| Background Jobs      | QStash (Upstash)                        | Scheduled signal runs, sequence delays        |
| Webhook Management   | Svix                                    | Email open/click/reply events                 |
| Analytics            | PostHog                                 | Product events, session replay                |
| Error Tracking       | Sentry                                  | Client + server + edge                        |
| Metrics              | prom-client                             | Prometheus-compatible `/metrics` endpoint     |
| Unit Tests           | Vitest v4                               |                                               |
| E2E Tests            | Playwright                              | API, pages, knowledge base, signals           |
| Payments             | `@x402/fetch`                           | x402 HTTP payment protocol (pay-per-use APIs) |
| Charts               | Recharts                                | Dashboard time-series                         |
| Linting              | ESLint + Prettier + lint-staged + Husky |                                               |

### What `@x402/fetch` Is

`@x402/fetch` implements the [x402 payment protocol](https://x402.org) — an emerging HTTP standard for micropayments, pushed by Coinbase. It wraps `fetch` to handle `402 Payment Required` responses automatically. This suggests some ChampHarbinger API endpoints (likely enrichment) are metered via x402 micropayments rather than subscription billing.

### Simplification Opportunities

**1. OpenRouter → Direct Anthropic SDK** (Priority: Medium)

OpenRouter adds a vendor-in-the-middle, markup on tokens, and an extra network hop. ChampHarbinger already defaults to Claude Sonnet 4.6 via OpenRouter. Switching to the Anthropic SDK directly gives:

- Prompt caching (60–80% cost reduction on repeated system prompts)
- Faster streaming (no proxy latency)
- Better cost visibility

Risk: Low. Vercel AI SDK supports both; swap is a config change in `src/lib/ai/provider.ts`. The only loss is the ability to one-line swap to GPT-4o or Gemini — worth it if Claude is the committed model.

**2. Enrichment source sprawl** (Priority: High)

Currently 5+ independent enrichment sources: Exa + Apify + Google Places + LakeB2B + LakeStream + GitHub + LinkedIn. Each has its own key, cost model, and error handling. This is the most expensive and complex part of the stack.

Immediate improvement: build a unified `enrichment-router.ts` that:

- Tries cheapest source first (Exa semantic search)
- Falls back to more expensive sources (Apify, Google) only on miss
- Caches results in the `enrichments` table (7-day TTL already exists)

Longer term: route through Champ IQ if it becomes the canonical enrichment layer.

**3. Supabase folder vs raw Postgres** (Priority: High)

`/supabase/migrations/` exists, but the app uses raw Drizzle + `DATABASE_URL`. There is no `@supabase/supabase-js` in `package.json`. This creates confusion about which migration path is canonical.

Two clean options:

- **Commit to Drizzle only:** delete the `/supabase/` directory, use `pnpm db:migrate` exclusively
- **Commit to Supabase:** add `@supabase/supabase-js`, use Supabase client + RLS, benefit from realtime and hosted auth

Currently carrying the overhead of both without benefiting from either. Drizzle-only is the simpler path since the app is self-hosted.

**4. Browserbase + Stagehand → Firecrawl for most cases** (Priority: Low-Medium)

Browser automation is the most fragile and expensive enrichment path. Stagehand uses an LLM to navigate sites — it's powerful but slow and costly. Most use cases (blog scraping, company pages, job listings with static HTML) don't need a full browser.

Firecrawl handles most scraping without browser overhead at a fraction of the cost. Keep Browserbase + Stagehand for:

- Job listings pages that require JS rendering
- Sites with anti-scraping that need real browser fingerprinting

**5. QStash for signal runs → Vercel Cron** (Priority: Low)

QStash is well-suited for sequence step delays (hours/days between emails). For signal runs (recurring weekly/daily schedules), Vercel Cron is simpler — one `vercel.json` entry instead of a QStash subscription. Both are appropriate; this is a simplification, not a fix.

---

## 7. Key File Locations

| Concern                   | File                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| AI system prompt          | [src/lib/system-prompt.ts](../../src/lib/system-prompt.ts)                       |
| LLM provider config       | [src/lib/ai/provider.ts](../../src/lib/ai/provider.ts)                           |
| All AI tools              | [src/lib/tools/](../../src/lib/tools/)                                           |
| Signal execution          | [src/lib/signals/executor.ts](../../src/lib/signals/executor.ts)                 |
| Exa service               | [src/lib/services/exa-service.ts](../../src/lib/services/exa-service.ts)         |
| Email outreach sender     | [src/lib/services/outreach-sender.ts](../../src/lib/services/outreach-sender.ts) |
| Cost tracking             | [src/lib/services/cost-tracker.ts](../../src/lib/services/cost-tracker.ts)       |
| DB schema                 | [db/schema.ts](../../db/schema.ts)                                               |
| Integration registry      | [src/lib/integrations.ts](../../src/lib/integrations.ts)                         |
| Monitoring metrics        | [src/lib/monitoring/metrics.ts](../../src/lib/monitoring/metrics.ts)             |
| Marketing pages           | [src/app/(marketing)/](<../../src/app/(marketing)/>)                             |
| App pages                 | [src/app/(app)/](<../../src/app/(app)/>)                                         |
| Existing architecture doc | [docs/architecture.md](../architecture.md)                                       |
| Signal authoring guide    | [docs/signal-authoring.md](../signal-authoring.md)                               |

---

## 8. Branding Fix Checklist

These are the specific files to update:

- [ ] **`docs/setup.md`** — Replace all "Signal" references with "ChampHarbinger", update the repo clone URL, replace `ANTHROPIC_API_KEY` with `OPENROUTER_API_KEY`, replace Supabase setup instructions with Docker Compose + Drizzle steps, replace "AgentMail" with "ChampMail"
- [ ] **`.env.example` (CHAMPMAIL block)** — Add a comment explaining why `CHAMPMAIL_` prefix differs from `HARBINGER_` convention
- [ ] **`src/components/marketing/hero.tsx:19`** — Verify "12 Champions Group companies" is accurate before launch
- [ ] **`README.md:67`** — Broken docs path reference: `docs/superpowers/plans/2026-04-30-champ-harbinger-implementation.md` — fix or remove

---

_Last updated: 2026-05-12. Internal use only._
