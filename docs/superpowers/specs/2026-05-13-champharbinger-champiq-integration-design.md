# ChampHarbinger ↔ ChampIQ Integration Design

**Date:** 2026-05-13
**Status:** Approved

---

## Context

ChampHarbinger and ChampIQ serve different roles in the Champ suite. ChampHarbinger is the signal intelligence and research engine ("who should we talk to, and why now?"). ChampIQ is the AI-SDR execution platform ("go get them, and don't stop until they reply"). This spec defines how they connect so users get a single seamless workflow: ChampHarbinger finds and qualifies the right people, ChampIQ chases them.

ChampHarbinger must continue to work fully standalone — its own outreach sequences remain intact. The ChampIQ connection is additive, not a replacement.

---

## Design Principles

- **API-first.** ChampIQ pulls from ChampHarbinger via a REST API. Webhooks (push) are Phase 2.
- **Standalone fallback always works.** Disconnecting ChampIQ changes nothing about how ChampHarbinger runs internally.
- **User controls aggression.** Three handoff modes (fully automatic, review queue, per-signal) are user-configurable — not hardcoded.
- **Signal context travels with the prospect.** Signal reasoning and data are part of the handoff payload so ChampIQ can personalise outreach from day one.

---

## Section 1 — ChampHarbinger REST API

Six new Next.js route handlers under `/api/v1/`. All authenticated via `Authorization: Bearer <api_key>` where the key is generated in ChampHarbinger's Settings → Integrations panel.

### Endpoints

| Method | Path                          | Purpose                                                                 |
| ------ | ----------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/v1/signals`             | List all signals with id, name, category, execution_type, config        |
| `POST` | `/api/v1/signals/run`         | Run a signal against a domain, return fired/not-fired + reasoning       |
| `POST` | `/api/v1/discover`            | Discover companies matching an ICP description                          |
| `POST` | `/api/v1/enrich/company`      | Full enrichment for a domain (Exa, Browserbase, job listings, contacts) |
| `POST` | `/api/v1/enrich/contact`      | Enrich a specific person (LinkedIn, email discovery, score)             |
| `GET`  | `/api/v1/prospects/qualified` | Pull all prospects that have cleared the handoff threshold              |

### Payload shapes

**POST `/api/v1/signals/run`**

```json
// Request
{ "signal_id": "uuid", "domain": "acme.com" }

// Response
{
  "fired": true,
  "reasoning": "Posted 8 senior DevOps roles referencing Kubernetes migration in 3 weeks",
  "data": { "job_count": 8, "roles": ["Senior DevOps", "Platform Engineer"] },
  "fired_at": "2026-05-13T09:00:00Z"
}
```

**POST `/api/v1/discover`**

```json
// Request
{ "icp": "SaaS companies with 50-200 employees hiring VPs of Sales", "industry": "SaaS", "location": "Austin, TX", "size": "50-200" }

// Response
{ "companies": [{ "name": "Acme", "domain": "acme.com", "size": 120, "industry": "SaaS" }] }
```

**POST `/api/v1/enrich/company`**

```json
// Request
{ "domain": "acme.com" }

// Response
{
  "company": { "name": "Acme", "domain": "acme.com", "size": 120, "industry": "SaaS", "description": "..." },
  "contacts": [{ "name": "Jane Smith", "title": "VP Engineering", "email": "jane@acme.com", "linkedin_url": "..." }],
  "score": 8.4,
  "talking_points": ["Hired 3 DevOps roles this month", "Series B Jan 2026"]
}
```

**POST `/api/v1/enrich/contact`**

```json
// Request
{ "name": "Jane Smith", "domain": "acme.com", "title": "VP Engineering" }

// Response
{ "contact": { "name": "Jane Smith", "email": "jane@acme.com", "linkedin_url": "...", "title": "VP Engineering" }, "score": 7.8 }
```

**GET `/api/v1/prospects/qualified`**

```
?since=2026-05-01T00:00:00Z&limit=50&cursor=abc123

Response: {
  "prospects": [{
    "company": { ... },
    "contacts": [ ... ],
    "signal": { "name": "Hiring Surge", "fired_at": "...", "reasoning": "...", "data": { ... } },
    "score": 8.4,
    "talking_points": [ ... ],
    "qualified_at": "2026-05-13T08:00:00Z"
  }],
  "next_cursor": "def456"
}
```

### Authentication

API keys are stored in the existing `integrations` table with `key = 'champiq_api_key'` and `workspace_id` scoping. A key is generated (crypto-random, prefixed `chh_`) when the user clicks "Generate API key" in Settings. Keys can be rotated; rotation immediately invalidates the previous key.

Middleware at `src/middleware.ts` validates the Bearer token on all `/api/v1/*` routes before the request reaches the handler. The `/api/v1/*` matcher runs before Clerk's auth check so external callers (ChampIQ) are not redirected to the sign-in page. Clerk auth is skipped entirely for these routes.

---

## Section 2 — ChampIQ Canvas Nodes

Five new node types added to ChampIQ's manifest-based tool registry, grouped under a "ChampHarbinger" category:

| Node                        | Calls                             | Inputs                          | Output variables                                                     |
| --------------------------- | --------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| **Discover Companies**      | `POST /api/v1/discover`           | icp, industry, location, size   | `companies[]`                                                        |
| **Run Signal**              | `POST /api/v1/signals/run`        | signal_id, `{{company.domain}}` | `signal.fired`, `signal.reasoning`, `signal.data`, `signal.fired_at` |
| **Enrich Company**          | `POST /api/v1/enrich/company`     | `{{company.domain}}`            | `company`, `contacts[]`, `score`, `talking_points`                   |
| **Enrich Contact**          | `POST /api/v1/enrich/contact`     | name, domain, title             | `contact`, `contact.email`, `contact.score`                          |
| **Get Qualified Prospects** | `GET /api/v1/prospects/qualified` | since, limit                    | `prospects[]`                                                        |

Output variables from each node pipe into downstream nodes as template variables. For example, `{{signal.reasoning}}` can be used directly in a ChampMail subject line for automatic personalisation.

**Run Signal** has two output branches: `fired` (continue to enrichment) and `not_fired` (skip/end branch). Both are configurable in the node inspector panel.

ChampIQ stores the ChampHarbinger URL and API key in its own settings (Settings → Connected tools → ChampHarbinger). ChampIQ exposes a health check at `GET /api/harbinger/health` so ChampHarbinger can verify the connection is live.

---

## Section 3 — Handoff Control

### Settings UI (Settings → Integrations → ChampIQ)

Contains:

1. **Connection panel** — ChampIQ URL, API key input, connection status dot, "Test connection" button, "Disconnect" link.
2. **Handoff mode selector** — three radio options:
   - _Fully automatic_ — push qualified prospects to ChampIQ immediately, no human step
   - _Review queue_ — prospects land in the Dashboard queue; user pushes each one
   - _Per-signal control_ — handoff mode set individually per signal (see table below)
3. **Per-signal table** (shown only when per-signal mode is active) — one row per signal with an Auto/Review toggle and a minimum score threshold input.

Settings are stored in the `integrations` table: `key = 'champiq_handoff_mode'` (value: `auto` | `review` | `per_signal`) and `key = 'champiq_signal_config'` (value: JSON map of signal_id → `{ mode, min_score }`).

In `auto` and `review` modes, the global minimum ICP score for a prospect to enter the queue is **6.0** (matching the existing signal executor threshold). In `per_signal` mode, each signal's `min_score` overrides this per row.

### Dashboard Review Queue Widget

Visible on the Dashboard when handoff mode is `review` or `per_signal` and at least one prospect is pending. Shows:

- Header: "Ready for ChampIQ" with a count badge
- "Push all" button to approve the entire queue in one click
- Per-prospect row: company name, signal reasoning (inline, italic), "Push" and "✕" (discard) buttons

Pushing sends the prospect payload to ChampIQ via `POST /api/v1/prospects/push` (a ChampIQ-side ingest endpoint, Phase 2 — for Phase 1 API pull, ChampIQ polls `GET /api/v1/prospects/qualified` and the queue widget is informational only, updated when ChampIQ fetches).

Prospects are stored in a new `champiq_queue` table: `id`, `workspace_id`, `company_id`, `contact_ids` (array), `signal_id`, `signal_data`, `score`, `talking_points`, `status` (`pending` | `pushed` | `discarded`), `created_at`, `pushed_at`.

---

## Section 4 — Standalone vs Connected Mode

### Mode detection

On app startup (and on Settings save), ChampHarbinger checks for `champiq_url` and `champiq_api_key` in the `integrations` table. If found, it pings `GET /api/harbinger/health` on ChampIQ. Connection status is cached for 60 seconds.

- **Not configured** → standalone mode. No UI changes. Sidebar shows a subtle "Connect ChampIQ →" prompt in the settings area.
- **Configured + reachable** → connected mode. Sidebar shows a green "ChampIQ live" indicator.
- **Configured but unreachable** → connected mode, degraded. Shows an amber indicator. Outbound pushes queue silently and retry with exponential backoff up to 1 hour. After 1 hour of failed delivery, a banner on the Dashboard alerts the user.

### Outreach page

The Outreach page gains a **ChampIQ / Standalone** tab toggle in connected mode. Both tabs are always accessible; switching is non-destructive.

- **ChampIQ tab** — shows handoff stats derived from the local `champiq_queue` table (pending, pushed today, total pushed). Does not attempt to show real-time ChampIQ canvas state — that requires Phase 2 callback support. Includes a link to the Dashboard review queue widget.
- **Standalone tab** — the existing sequences UI, unchanged.

In standalone mode, only the Standalone tab renders (no toggle shown).

---

## Out of scope (Phase 2)

- Webhook push from ChampHarbinger → ChampIQ on signal fire
- Two-way outcome sync (ChampIQ replies feed back into ChampHarbinger contact records)
- Shared auth / SSO between the two apps

---

## Implementation order

1. **ChampHarbinger** — API middleware + 6 route handlers
2. **ChampHarbinger** — API key generation in Settings → Integrations
3. **ChampHarbinger** — `champiq_queue` table migration
4. **ChampHarbinger** — Handoff mode settings UI + per-signal table
5. **ChampHarbinger** — Review queue widget on Dashboard
6. **ChampHarbinger** — Standalone/Connected mode detection + Outreach page toggle
7. **ChampIQ** — Health endpoint + ChampHarbinger connection settings panel
8. **ChampIQ** — Five canvas node types in the manifest registry
