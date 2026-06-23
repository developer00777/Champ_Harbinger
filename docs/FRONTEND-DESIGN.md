# ChampHarbinger — Front-End Design Doc

> Handoff doc for the front-end designer. Covers what the product is, the design
> system already in code, the information architecture, the key screens/flows,
> and where design effort will pay off. Everything here reflects the current
> shipping UI (branch `feat/quick-start-hub`), not a wishlist.

---

## 1. Product in one paragraph

**ChampHarbinger** is the B2B prospecting + outreach workspace in the Champions
Group product family. A salesperson points it at a set of companies (uploads a
list **or** describes the kind of company they want), and the app finds the
right contacts, enriches them with public signals (LinkedIn, news, hiring,
funding), and drafts **personalized cold emails** — then tracks opens/replies
across campaigns. It's used by **small revenue teams (~20–30 people per
deployment)** sharing one workspace, so the same person is often researching,
drafting, and reviewing in one sitting. The feel we want: **fast, warm,
confidence-inspiring — "a sharp assistant did the homework for me,"** not a
data-entry CRM.

**Primary users:** SDRs / AEs / founders doing outbound. Mostly desktop, in long
focused sessions. Not designers, not engineers — they want the next action to be
obvious.

---

## 2. Design principles (what "good" means here)

1. **One obvious next step per screen.** Every view should make the primary
   action unmissable. Secondary actions recede.
2. **Show the work, earn the trust.** This product makes AI-written claims about
   real people. Surface _why_ a contact was picked and _what signal_ drove a
   draft. Never let it feel like a black box.
3. **Warm, not loud.** Champions orange is an accent, not a wash. Lean on
   neutrals + whitespace; use orange to point.
4. **Calm density.** Power users scan lists of companies/contacts/drafts.
   Tight, legible rows beat roomy cards once you're past onboarding.
5. **Never remove a capability to make it prettier.** Simplify the path to it
   instead. (Explicit product constraint — see §8.)

---

## 3. Brand & design tokens

The theme is **already implemented** as CSS variables in
[`src/app/globals.css`](../src/app/globals.css) and consumed through Tailwind 4

- shadcn/ui. **Design against these tokens, not raw hex** — anything token-driven
  gets correct light/dark for free. Raw brand hex exists only for marketing
  gradients.

### Champions Group brand palette (raw)

| Token                        | Hex                               | Use                           |
| ---------------------------- | --------------------------------- | ----------------------------- |
| `champions-orange`           | `#F26722`                         | Primary brand accent          |
| `champions-deep-orange`      | `#D94F0A`                         | Hover / pressed, gradient end |
| `champions-bright-orange`    | `#FF8544`                         | Dark-mode primary, highlights |
| `champions-soft-peach`       | `#FFF4EC`                         | Tinted backgrounds            |
| `champions-warm-tint`        | `#FFE8D6`                         | Tinted backgrounds            |
| `champions-ink` / `ink-soft` | `#1A1A1A` / `#2E2E2E`             | Headlines on light            |
| `champions-warm-gray`        | `#6B6B6B`                         | Secondary text                |
| neutrals                     | `#E5E7EB` / `#F5F5F5` / `#FAFAFA` | Borders / fills               |

Gradients available as utilities: `champions-gradient`, `warm-sunset`,
`peach-wash`, `orange-fade` (mainly marketing/landing).

### Semantic tokens (the ones to actually design with)

Defined in **OKLCH**, with full **light + dark** sets. Use these names:

`background` `foreground` `card` `card-foreground` `popover` `primary`
(= orange) `primary-foreground` `secondary` `muted` `muted-foreground`
`accent` `highlight` (a magenta-pink, `oklch(0.7 0.21 355)` — used for
emphasis/charts) `destructive` `border` `input` `ring` `chart-1…chart-5`
and a parallel **`sidebar-*`** set (`sidebar`, `sidebar-foreground`,
`sidebar-primary`, `sidebar-accent`, `sidebar-border`, `sidebar-ring`).

- **Dark mode is real and supported** (`.dark` overrides every token; primary
  shifts orange → bright-orange). Every screen must look right in both.
- **Charts** use `chart-1` (orange) → `chart-5` (light blue) + `highlight`
  (pink). Keep data viz on this ramp.

### Radius & shape

Base `--radius: 0.625rem` (10px), with a scale: `sm` `md` `lg` `xl` `2xl` `3xl`
`4xl`. Cards/inputs use `lg`; pills/avatars use `lg`–`full`. The product reads
**soft-rounded**, not sharp.

### Typography

- **Sans:** Inter (`--font-inter`) — all UI text.
- **Mono:** Geist Mono (`--font-geist-mono`) — code, IDs, monospace data.
- Current scale in use: page title `text-2xl font-bold tracking-tight`, section
  headers `text-lg font-semibold` / `text-sm font-semibold`, body `text-sm`,
  meta `text-xs text-muted-foreground`. There is **no formalized type scale doc
  yet** — defining one is a good early deliverable (see §7).

---

## 4. Information architecture & app shell

### The shell (every authed screen)

[`dashboard-shell.tsx`](../src/components/dashboard-shell.tsx) +
[`app-sidebar.tsx`](../src/components/app-sidebar.tsx):

```
┌───────────┬─────────────────────────────────────────────┐
│           │  sticky header (h-12): [sidebar toggle]      │
│  SIDEBAR  │                         [Agent ▸] toggle     │
│ (inset,   ├─────────────────────────────────────────────┤
│ collapses │                                   │  AGENT  │
│ to icons) │   page content (scrolls)          │  PANEL  │
│           │                                   │ (slide- │
│           │                                   │  in)    │
└───────────┴───────────────────────────────────┴─────────┘
```

- **Sidebar** is `variant="inset"`, `collapsible="icon"` — collapses to an icon
  rail. Header tile = "CH" mark + "ChampHarbinger".
- **Nav (in order):** Overview · Chat · Campaigns · Signals · Tracking ·
  Outreach · Profiles. Below: a campaigns quick-switcher.
- **Footer:** a ChampIQ live-status row (green dot "ChampIQ live" / "Connect
  ChampIQ" prompt) → Admin (super-admin only) · Settings · Feedback →
  **account dropdown** (avatar, name, email, Log out). _The account block was
  just fixed to show the real signed-in identity via Clerk._
- **Agent panel** slides in on the right; the header button reads "Agent" or
  "Campaign Agent" depending on context, and is hidden on `/chat`.

### Route map

| Route                           | Purpose                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `/dashboard` (**Overview**)     | Home. Quick Start + cross-campaign KPIs. See §5.                                          |
| `/chat`, `/chat/[id]`           | Conversational agent — research/draft via chat.                                           |
| `/campaigns`, `/campaigns/[id]` | Campaign list + detail (companies, contacts, sequence, performance).                      |
| `/signals`                      | Buying/intent signals fired across tracked accounts.                                      |
| `/tracking`                     | Ongoing monitors (news/RSS/hiring/page-change) per company.                               |
| `/outreach`, `/outreach/review` | Draft queue + review-before-send.                                                         |
| `/profile`                      | Sender profiles (name/title/company/signature used in drafts).                            |
| `/email-skills`                 | User-authored email "skills" (reusable copy rules layered into the AI prompt).            |
| `/settings`                     | API keys, ChampIQ connection, costs, account.                                             |
| `/admin`                        | **Super-admin only** — teams, weekly budgets, per-user limits, invites, spend monitoring. |
| `/(marketing)`                  | Public landing (uses the brand gradients).                                                |

---

## 5. The hero flow — Overview + Quick Start

This is the screen that decides whether a new user "gets it." It's where the
most design attention should go.

### Overview stack ([`dashboard/page.tsx`](<../src/app/(app)/dashboard/page.tsx>)), top → bottom

1. **Page header** — "Overview / Cross-campaign performance at a glance."
2. **Quick Start hub** ← _now first, above the fold_ (the headline flow).
3. **ChampIQ queue widget** — live status of the connected Champ Sets feed.
4. **Stat cards** — leads / sent / opened / replied / bounced.
5. **Outreach chart** — time series with a range switch (7d/30d/…).
6. **Top signals fired** — ranked list with orange counts.
7. **Campaigns table** — per-campaign leads, open rate, reply rate.

### Quick Start hub ([`quick-start/quick-start-hub.tsx`](../src/components/quick-start/quick-start-hub.tsx))

A single card that walks the user through **4 steps** with a dot **step
indicator** (entry → companies → contacts → drafts). Sparkles icon + "Go from
companies to personalized drafts in a few clicks."

1. **Entry.** A "Campaign context" block (pick an existing campaign **or** type
   one line: "what you sell / who you target"), then a **tabbed** entry:
   - **Describe criteria** — textarea (placeholder: _"B2B SaaS, 10–50 employees,
     US, seed-funded"_) → **Find companies**.
   - **Upload companies** — CSV/Excel of company names → staged into the campaign.
2. **Companies.** "_N companies staged_" list (name + domain · industry ·
   location). Primary: **Find contacts**.
3. **Contacts.** Found contacts as selectable rows (checkbox, name, title ·
   company, an **external-link icon → LinkedIn**), with **Select all**. Primary:
   **Draft N messages**.
4. **Drafts.** One editable card per draft — recipient line, **Subject** input,
   **Body** textarea (DeepSeek-personalized, edits preserved) → **Save drafts**
   → "✓ Drafts saved." Back/Discard returns to start.

**Design opportunities here (high value):**

- The 4-step flow currently lives in **one dense card**. Consider a clearer
  stepper, per-step affordance for "what happens next," and a stronger empty/
  first-run state ("Drop a list or describe your ideal customer").
- The **LinkedIn action** is a tiny icon today — the product owner wants the
  LinkedIn-for-outreach moment to be **prominent and obvious**. Worth elevating
  to a labeled button.
- **Loading is slow-ish** (discovery + contact-finding are real network/LLM
  work). The states exist (spinners, skeletons) but deserve reassuring,
  progress-style microcopy so it never feels stuck.
- Make the **"why this contact / why this angle"** visible — the AI returns a
  one-line reasoning per draft; surfacing it builds trust (principle #2).

---

## 6. Component system

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind 4 · **shadcn/ui** ·
**lucide-react** icons · Clerk for auth UI. Components live under
`src/components/` grouped by feature (`dashboard/`, `quick-start/`, `chat/`,
`campaign/`, `outreach/`, `signals/`, `tracking/`, `settings/`, `admin/`,
`email-skills/`, `marketing/`) with shared primitives in `ui/`.

### Primitives available (`src/components/ui/`)

`avatar` · `button` · `dialog` · `dropdown-menu` · `input` · `select` ·
`textarea` · `switch` · `tabs` · `tooltip` · `popover` · `sheet` · `separator` ·
`skeleton` (+ `skeleton-presets`) · `sidebar` · `markdown` — plus
**domain-specific** ones worth knowing:

- `score-badge`, `status-pill`, `priority-callout` — for lead scoring / status.
- `stat-card` — the KPI tiles.
- `social-post-card`, `editable-email`, `relative-time`, `toggle-pill`.

**Convention:** new UI should compose shadcn primitives + tokens. Avoid one-off
hex and ad-hoc spacing; reach for the existing primitives so light/dark and
density stay consistent.

---

## 7. Current state & where design adds the most value

The app is **functionally complete and consistent**, but grew feature-first.
Highest-leverage design work, roughly in priority order:

1. **Formalize the design language.** Lock a type scale, spacing scale, and a
   small set of "card / list-row / section-header" patterns so every feature
   page reads as one product. (Tokens already exist — this is about usage rules.)
2. **Quick Start polish** (§5) — the make-or-break onboarding moment.
3. **Empty & first-run states.** New users land on zeroed stat cards and empty
   tables. Design real empty states that point at Quick Start.
4. **List/row density + scannability** across Campaigns, Contacts, Outreach
   review, Signals — these are the daily-driver screens.
5. **Loading/progress language** for the long AI/network steps (discovery,
   contact-finding, drafting). Make waiting feel like progress.
6. **Trust surfaces** — consistently show enrichment signals and AI reasoning so
   claims feel sourced.
7. **Responsive pass.** Desktop-first today; the sidebar + agent panel + dense
   tables need a deliberate tablet/mobile story (the shell already has
   `isMobile` hooks to build on).
8. **Dark mode QA.** Tokens are wired, but every new comp should be checked in
   both themes.

---

## 8. Hard constraints (please design within these)

- **Do not remove or hide existing functionality.** The goal is to make the same
  capabilities _easier and more intuitive_, not fewer. Simplify the path, keep
  the power.
- **Token-driven theming, light + dark.** No hardcoded colors outside the brand
  gradient utilities; both themes must work.
- **Account / auth UI is Clerk-managed.** The sign-in, user menu identity, and
  invite flows come from Clerk — design around its components, don't reinvent
  the auth screens.
- **Super-admin surfaces are gated.** `/admin` and the Admin nav entry only
  render for super-admins; design them as an internal console, not a user
  feature.
- **Accessibility:** keyboard-navigable, visible focus rings (`ring` token
  already used), proper labels (the codebase uses `aria-label`/`sr-only` — keep
  it up), AA contrast in both themes.

---

## 9. Practical handoff

- **Run it:** `pnpm install && pnpm dev` (Next dev server). Auth via Clerk;
  ask the team for a dev invite to see authed screens.
- **Where to look:** `src/app/(app)/<route>/page.tsx` for each screen;
  `src/components/<feature>/` for that screen's pieces; `src/components/ui/` for
  primitives; `src/app/globals.css` for the single source of truth on tokens.
- **Icons:** lucide-react (already a dependency) — match the existing set.
- **Best first deliverables:** (a) a one-page type + spacing scale built on the
  current tokens, (b) a redesigned Quick Start + Overview empty state, (c) a
  shared list-row spec for the daily-driver screens.

> Designs should be expressible in these tokens + shadcn primitives so they drop
> straight into the codebase. When in doubt, open the running app and the
> matching `page.tsx` side by side — the structure is all there; it needs a
> designer's eye for hierarchy, rhythm, and the first-run moment.
