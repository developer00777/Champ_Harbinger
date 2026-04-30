# ChampHarbinger

A Champions Group product. ChampHarbinger detects buying signals on the web before they become deals — monitoring hiring, funding, news, and review-sentiment shifts, then enriching contacts and drafting personalized outreach in a chat-first workspace.

The name *Harbinger* — "a signal that something is coming" — names the product concept directly: ChampHarbinger surfaces buying intent before it becomes a deal.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

---

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Drizzle ORM · Postgres 16 · Clerk · OpenRouter (Vercel AI SDK) · Sentry · Prometheus.

---

## Features

- **Intent signals engine** — authorable recipes that watch companies and surface buying triggers (hiring changes, funding, news, review shifts).
- **Campaign workspace** — chat-driven interface backed by AI to research, shortlist, and draft outreach.
- **Contact enrichment** — pulls LinkedIn, GitHub, and company pages into a single profile.
- **Outreach sequences** — multi-step email sequences with open/reply tracking.
- **Browser automation** — Browserbase + Stagehand for the long tail of sites without APIs.
- **Own your data** — Postgres + Drizzle ORM on your own infrastructure.

---

## Local development

**Requirements:** Docker, pnpm, a Clerk project, an OpenRouter API key.

```bash
git clone <repo-url> champ-harbinger
cd champ-harbinger
cp .env.example .env.local
# Fill in CLERK_*, OPENROUTER_API_KEY, and any optional integrations
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

App at http://localhost:3000.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk public key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `HARBINGER_DEFAULT_MODEL` | Yes | Default LLM (e.g. `anthropic/claude-sonnet-4-6`) |
| `SENTRY_DSN` | Optional | Sentry error tracking |
| `BROWSERBASE_API_KEY` | Optional | Web automation |
| `EXA_API_KEY` | Optional | Web search enrichment |

---

## Deployment

**Railway (recommended for staging):** see `docs/superpowers/plans/2026-04-30-champ-harbinger-implementation.md` for the full staging setup. Any standard Postgres host works — the only thing that changes is `DATABASE_URL`.

**Docker Compose (local):**

```bash
docker compose up
```

Provisions Postgres 16 + the Next.js app. Requires `.env.local` to be populated first.

---

## Champions Group

ChampHarbinger is part of the Champ suite — sitting alongside ChampOracle, ChampMail, ChampIQ, ChampQuest, ChampTrack, ChampUTM, ChampVideo, and ChampVox.

*Empowering Innovation. Building Resilience.*

---

License: AGPL-3.0-only. © 2026 Champions Group.
