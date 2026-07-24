# Deploying ChampHarbinger: Coolify (backend) + Vercel (app)

A step-by-step runbook for a **split deploy**: the stateful/self-hosted pieces
— Postgres, the pg-boss worker, and the scraper microservices — run on
**Coolify** on your own VPS; the Next.js 16 app (frontend + all API routes)
deploys to **Vercel**.

This is a different network topology than the single-project
`docs/DEPLOY-RAILWAY.md` runbook, which puts everything on one private
network. Here, Coolify and Vercel are **separate clouds with no private link
between them** — anything the Vercel app needs to reach (Postgres, the
scrapers) must be exposed on the public internet from Coolify, over TLS, with
real credentials. Read [§0](#0-topology--what-changes-vs-a-single-network-deploy)
before you start; it's the one thing this topology gets wrong if you skip it.

> **Golden rule:** only the **worker** and the **scraper microservices** are
> Coolify's job. The **app** is Vercel's job — don't deploy the Next.js app to
> Coolify too (you'd be running it twice, out of sync).

---

## 0. Topology — what changes vs. a single-network deploy

| Component                                   | Runs on     | Reachable by                                   | Exposure                                                                    |
| ------------------------------------------- | ----------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| **app** (Next.js)                           | **Vercel**  | Everyone (that's the point)                    | Public HTTPS (Vercel-managed)                                               |
| **worker** (pg-boss)                        | **Coolify** | Nothing inbound — it only makes outbound calls | No domain, no exposure                                                      |
| **postgres**                                | **Coolify** | Vercel app (public) + Coolify worker (private) | **Public**, TLS + strong password                                           |
| **obscura / trafilatura / searxng**         | **Coolify** | Vercel app (public) + Coolify worker (private) | **Public** (see [§6 security](#6-security-notes-specific-to-this-topology)) |
| _crawl4ai / ollama / prometheus_ (optional) | **Coolify** | Same as above if used                          | Public if the app needs them                                                |

The load-bearing difference from `DEPLOY-RAILWAY.md`: on Railway everything
shares one private network, so only the app gets a public domain. Here,
**Postgres and the scrapers must be public** too, because Vercel's serverless
functions have no route into Coolify's private Docker network — they can only
reach things over the internet. The worker, which lives on Coolify next to
Postgres and the scrapers, keeps using Coolify's internal service names for
those (no change there); it's specifically the **Vercel→Coolify** direction
that has to go over public HTTPS.

Practical upshot:

- Postgres needs a strong password and `sslmode=require` (§1).
- The scrapers hold no secrets and no user data — worst case if someone finds
  the URL is bandwidth abuse, not a data leak — but you should still restrict
  them (§6).
- Migrations get _simpler_ here than on Railway: since Postgres is public
  anyway, you can run `pnpm db:migrate` from your own machine against the
  public `DATABASE_URL` instead of needing a special pre-deploy step (§5).

---

## 1. Coolify: Postgres

1. In Coolify: **New Resource → Database → PostgreSQL**. Don't use Coolify's
   default Postgres image — you need **pgvector** (migration `0008` runs
   `CREATE EXTENSION IF NOT EXISTS "vector"` and adds an HNSW index on
   `organizations.embedding`). Two ways:
   - **Preferred:** when adding the database, override the Docker image to
     `pgvector/pgvector:pg16` (Coolify lets you set a custom image for a
     database resource).
   - **Or:** use Coolify's standard Postgres image, then connect once with
     `psql`/Coolify's SQL console and run `CREATE EXTENSION IF NOT EXISTS
vector;` before the first migration. Confirm the image's Postgres
     contrib packages actually include `pgvector` first — if not, switch to
     the pgvector image instead of fighting it.
2. Set a strong `POSTGRES_PASSWORD` (Coolify can generate one). Database name
   `champ_harbinger`, user `harbinger` (or whatever you like — just be
   consistent in `DATABASE_URL` below).
3. **Networking → make the database's port publicly reachable.** This is the
   one Postgres setting that's different from a normal Coolify deploy — you
   need Vercel to reach it. Coolify exposes a public host:port for the
   database when you enable "Public Port" (or similar, depending on your
   Coolify version) on the resource. Note the public host and port.
4. Your `DATABASE_URL` for both Vercel (public) and the Coolify worker
   (can use the same public URL, or the private `postgres:5432` if you'd
   rather keep worker traffic off the public port — either works, since the
   worker sits on the same Coolify network):
   ```
   postgresql://harbinger:<password>@<public-host>:<public-port>/champ_harbinger?sslmode=require
   ```
   Always include `sslmode=require` for the public connection string — this
   Postgres is now internet-facing.

---

## 2. Coolify: the scraper microservices

Deploy each as its own Coolify **Application** (Dockerfile-based, built from
this repo) with a **public domain** (Coolify's built-in proxy handles TLS via
Let's Encrypt automatically once you attach a domain).

| Service                 | Coolify Base Directory     | Dockerfile   | Internal port | Healthcheck |
| ----------------------- | -------------------------- | ------------ | ------------- | ----------- |
| **obscura**             | `services/obscura-gateway` | `Dockerfile` | 9223          | `/health`   |
| **trafilatura**         | `services/trafilatura`     | `Dockerfile` | 8001          | `/health`   |
| **crawl4ai** (optional) | `services/crawl4ai`        | `Dockerfile` | 8000          | `/health`   |

For each: **New Resource → Application → Public Repository / your Git
source →** this repo, set **Base Directory** to the service's subfolder (so
the Dockerfile's relative `COPY` lines resolve, same reasoning as Railway's
Root Directory setting), **Build Pack = Dockerfile**, attach a domain, deploy.

**SearXNG** is the stock image plus this repo's settings file:

- **New Resource → Application → Docker Image** → `searxng/searxng:latest`.
- It needs `services/searxng/settings.yml` (enables the JSON output format
  the app's discovery code requires) mounted at `/etc/searxng/settings.yml`
  — either as a Coolify **persistent volume/file mount** you upload the file
  into, or build a 3-line wrapper Dockerfile that `COPY`s it in and deploy
  that as an Application instead of a raw Docker Image.
- Set `SEARXNG_BASE_URL` to the public domain Coolify assigns, and override
  the placeholder `secret_key` in `settings.yml` (or via `SEARXNG_SECRET`) —
  never ship the committed `champharbinger-change-me`.
- Attach a public domain, target port 8080.

Note each service's **public HTTPS URL** — you'll set these as
`OBSCURA_GATEWAY_URL`, `TRAFILATURA_BASE_URL`, `SEARXNG_URL`,
`CRAWL4AI_BASE_URL` on **both** the Vercel app and the Coolify worker.

> They degrade gracefully: unset URLs just make the corresponding tools
> report "not configured" instead of crashing. Deploy Postgres + worker +
> app first, confirm the core product works, add scrapers after.

---

## 3. Coolify: the worker

The worker is `scripts/run-worker.ts` — pg-boss schedules + job handlers
(tracking dispatch, mailbox sync, the AISDR reply agent, the signal
researcher, usage alerts). It must run as a **persistent, always-on
process** — this is exactly what Coolify is for and exactly what Vercel's
serverless model can't do, which is the whole reason for this split.

1. **New Resource → Application →** this repo. **Base Directory** = repo
   root (empty). **Build Pack = Dockerfile**, **Dockerfile = Dockerfile.worker**.
2. **No public domain** — nothing calls into the worker; it only makes
   outbound calls (to Postgres, the scrapers, and back to the Vercel app for
   job-triggered internal routes).
3. **Health check:** none — it's not HTTP-served (`Dockerfile.worker`'s `CMD`
   is `pnpm worker`, no listening port).
4. **Restart policy:** always/on-failure, matching Coolify's default for
   long-running services.
5. Environment variables (Coolify's per-resource env var editor):
   ```
   DATABASE_URL=postgresql://harbinger:<password>@<coolify-postgres-private-host>:5432/champ_harbinger
   OPENROUTER_API_KEY=sk-or-v1-xxx
   WORKER_SECRET=<same value you set on the Vercel app>
   WORKER_TARGET_URL=https://<your-vercel-app-domain>
   OBSCURA_GATEWAY_URL=https://<obscura-public-domain>
   TRAFILATURA_BASE_URL=https://<trafilatura-public-domain>
   SEARXNG_URL=https://<searxng-public-domain>
   CRAWL4AI_BASE_URL=https://<crawl4ai-public-domain>          # optional
   # fairness/budget knobs (same values as the app — see §4):
   FAIR_PER_USER_MAX=3
   FAIR_GLOBAL_MAX=8
   BOSS_FETCH_BATCH=20
   GLOBAL_WEEKLY_BUDGET_USD=50
   GLOBAL_DAILY_BUDGET_USD=15
   LLM_MAX_CONCURRENCY=12
   BUDGET_CACHE_TTL_MS=45000
   ENRICH_SET_CONCURRENCY=4
   # cron cadences (optional; defaults are sane — see .env.example):
   TRACKING_DISPATCH_CRON=*/5 * * * *
   OUTREACH_FOLLOWUPS_CRON=*/15 * * * *
   MAILBOX_SYNC_CRON=*/3 * * * *
   AISDR_CRON=*/5 * * * *
   SIGNAL_RESEARCH_CRON=*/10 * * * *
   USAGE_ALERTS_CRON=0 * * * *
   ```
   Use the **private** `DATABASE_URL` here (worker↔Postgres traffic stays on
   Coolify's internal network — no need to route it through the public
   port). `WORKER_TARGET_URL` is the one var that has to leave Coolify: it's
   the worker calling back into the Vercel-hosted app's internal job routes
   (`/api/aisdr/process`, `/api/admin/alerts/run`, `/api/outreach/process`,
   etc.), authenticated with the `X-Worker-Secret` header — see
   `src/lib/jobs/internal-auth.ts`.

> **`WORKER_SECRET` must be byte-identical on the worker (Coolify) and the
> app (Vercel).** Mismatched values make every internal job route reject the
> worker's calls with 401 — the worker will look "stuck" with no obvious error.

---

## 4. Vercel: the app

This is the easy part — Vercel's project settings are all one flat list of
environment variables (no separate "build args" step the way Docker/Railway
need; Vercel makes `NEXT_PUBLIC_*` vars available at build time automatically
as long as they're set on the project).

1. **Import the repo** into a new Vercel project. Framework preset:
   Next.js (auto-detected). **Do not** override the build command — `next
build` is correct; the `next.config.ts` in this repo already skips
   `output: "standalone"` when Vercel's `VERCEL=1` build env is present, so
   Vercel's own build/trace pipeline runs normally.
2. **Root Directory:** repo root (this isn't a monorepo).
3. **Environment Variables** (Project Settings → Environment Variables — set
   for Production, and Preview if you want preview deploys to work too):
   ```
   # --- Database (PUBLIC Coolify Postgres URL, sslmode=require) ---
   DATABASE_URL=postgresql://harbinger:<password>@<public-host>:<public-port>/champ_harbinger?sslmode=require

   # --- Clerk (REAL keys — keyless mode does NOT work in production) ---
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
   CLERK_SECRET_KEY=sk_live_xxx
   CLERK_FRONTEND_API_DOMAIN=clerk.yourdomain.com

   # --- LLM (the one key you're trying to get away with) ---
   OPENROUTER_API_KEY=sk-or-v1-xxx
   HARBINGER_DEFAULT_MODEL=anthropic/claude-sonnet-4.6

   # --- Self-hosted scraper URLs (PUBLIC Coolify domains, §2) ---
   OBSCURA_GATEWAY_URL=https://<obscura-public-domain>
   TRAFILATURA_BASE_URL=https://<trafilatura-public-domain>
   SEARXNG_URL=https://<searxng-public-domain>
   CRAWL4AI_BASE_URL=https://<crawl4ai-public-domain>          # optional

   # --- Secrets / app config ---
   HARBINGER_SECRET=<openssl rand -hex 16, >= 32 chars>
   WORKER_SECRET=<same value as the Coolify worker, §3>
   NEXT_PUBLIC_HARBINGER_APP_URL=https://<your-vercel-app-domain>

   # --- Multi-tenant / budgets / fairness — same values as the worker ---
   SUPER_ADMIN_USER_IDS=user_xxx                # your Clerk user id, for /admin
   GLOBAL_WEEKLY_BUDGET_USD=50
   GLOBAL_DAILY_BUDGET_USD=15
   LLM_MAX_CONCURRENCY=12
   FAIR_PER_USER_MAX=3
   FAIR_GLOBAL_MAX=8
   BOSS_FETCH_BATCH=20
   BUDGET_CACHE_TTL_MS=45000
   ENRICH_SET_CONCURRENCY=4

   # --- Optional ---
   ADMIN_ALERT_EMAIL=you@yourcompany.com
   ALERT_FROM_EMAIL=alerts@yourcompany.com
   APP_SETTINGS_CACHE_TTL_MS=30000
   INBOXKIT_API_KEY=...                          # only if you're using InboxKit
   INBOXKIT_WORKSPACE_ID=...
   INBOXKIT_WEBHOOK_SECRET=...
   BRIGHTDATA_API_TOKEN=...                      # only for LinkedIn Web Unlocker
   BRIGHTDATA_UNLOCKER_ZONE=...
   APOLLO_API_KEY=...                            # optional enrichment escalation
   PDL_API_KEY=...
   LAKEB2B_MOCK=true                             # until the real LakeB2B API is wired
   ```
4. **Deploy.** Vercel builds and serves the app on `<project>.vercel.app`
   (add a custom domain when ready — remember to update
   `NEXT_PUBLIC_HARBINGER_APP_URL` and `WORKER_TARGET_URL` on the worker to
   match, and add the domain in Clerk's allowed origins, §5).

---

## 5. Migrations, Clerk, and budgets

These three sections carry over from `docs/DEPLOY-RAILWAY.md` almost
unchanged — the differences are called out inline.

### 5a. Running migrations

Migrations are Drizzle SQL files in `db/migrations`, applied by `pnpm
db:migrate` (idempotent — only pending migrations run). **This topology
makes it simpler than Railway's**: since Postgres has a public URL anyway
(§1), just run it from your own machine whenever you ship a schema change,
pointed at the public connection string:

```bash
DATABASE_URL="postgresql://harbinger:<password>@<public-host>:<public-port>/champ_harbinger?sslmode=require" pnpm db:migrate
```

Do this once before the first deploy, and again after any PR that touches
`db/schema.ts`. (You could also wire it into a CI step or the Coolify
worker's startup — just make sure only **one** place runs it per deploy so
two processes don't race the same migration.)

### 5b. Clerk — keyless mode does NOT work in production

Same as Railway: **Clerk Keyless mode is a local-dev convenience only.**

1. Create a **production** Clerk instance for your domain.
2. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `CLERK_FRONTEND_API_DOMAIN` → set on the **Vercel** project (§4). The
   worker doesn't need Clerk keys — it never handles a browser session.
3. Add your Vercel domain(s) (`*.vercel.app` and any custom domain) to
   Clerk's allowed origins.
4. Clerk dashboard → **User & Authentication → Restrictions → Sign-up mode =
   `Restricted`** for an invite-only instance (the intended posture for a
   shared ChampHarbinger deploy).

### 5c. Budgets and the admin console

- **OpenRouter key-level credit limit** (hard backstop) — set this in the
  OpenRouter dashboard on the key you're using, independent of anything in
  this repo.
- **`GLOBAL_WEEKLY_BUDGET_USD`** / **`GLOBAL_DAILY_BUDGET_USD`** — set
  identically on the Vercel app and the Coolify worker (§3/§4). Daily is
  checked first, then weekly; both are soft, self-resetting caps on top of
  the OpenRouter hard limit.
- **`SUPER_ADMIN_USER_IDS`** — your Clerk user id, set on Vercel only (the
  worker never renders `/admin`).
- **Fairness knobs** (`LLM_MAX_CONCURRENCY`, `FAIR_PER_USER_MAX`,
  `FAIR_GLOBAL_MAX`) are **per-process**. Vercel scales the app horizontally
  under load by default (multiple serverless invocations), so
  `LLM_MAX_CONCURRENCY`'s semaphore is _per invocation_, not global — it
  won't coordinate across concurrent Vercel instances the way a single
  Railway/Coolify replica would. The OpenRouter key-level credit limit is
  what actually bounds total spend in this topology; treat the app-level
  knobs as best-effort smoothing, not a hard ceiling.

---

## 6. Security notes specific to this topology

This is the part that doesn't exist in the single-network Railway doc,
because there everything stayed private. Here, three things are genuinely
internet-facing that wouldn't otherwise be:

- **Postgres.** Strong, generated password; `sslmode=require` on every
  connection string; if your Coolify/VPS firewall supports it, restrict the
  public port to Vercel's outbound IP ranges (Vercel's static outbound IP
  add-on, if you're on a plan that has it) rather than leaving it open to
  the whole internet. At minimum, don't reuse this password anywhere else.
- **obscura / trafilatura / searxng / crawl4ai.** These hold no secrets and
  no user data — they're stateless fetch/render/search proxies — so the
  realistic worst case if someone finds a URL is bandwidth/compute abuse on
  your VPS, not a data breach. Still worth locking down:
  - Simplest: add Basic Auth via Coolify's built-in proxy middleware (a
    Traefik label) on each service's domain, and have the app's fetch calls
    include the credentials. This repo's HTTP clients (`fetchWithTimeout`
    and friends) don't currently thread per-URL basic-auth credentials
    through automatically — if you want this, either embed
    `https://user:pass@host` in the env var (works with Node's `fetch` for
    most of these call sites, but verify per-service before relying on it)
    or add an IP allowlist at the firewall/proxy level instead.
  - If you're not exposing anything sensitive and just want it working
    quickly for testing, it's reasonable to skip hardening these at first
    and revisit once you've got the app live — they're genuinely low-value
    targets.
- **`WORKER_SECRET`.** Since the worker calls the app's internal routes over
  the public internet (not a private network), this header is the _only_
  thing stopping a random request from `/api/aisdr/process`-style routes
  triggering a batch run. Make sure it's actually set (not left blank) —
  `verifyWorkerSecret()` in `src/lib/jobs/internal-auth.ts` treats an unset
  `WORKER_SECRET` as "allow everything," which is a deliberate local-dev
  convenience that must **not** ship to this deploy.

---

## 7. Verify it's live

```bash
# App healthcheck (Vercel):
curl -s -o /dev/null -w "%{http_code}\n" https://<your-vercel-domain>/api/metrics   # → 200

# Postgres reachable from outside (sanity check before pointing Vercel at it):
psql "postgresql://harbinger:<password>@<public-host>:<public-port>/champ_harbinger?sslmode=require" -c "select 1;"

# Each scraper's healthcheck, from anywhere:
curl -s https://<obscura-domain>/health
curl -s https://<trafilatura-domain>/health

# Worker: check Coolify's logs for the resource — should show pg-boss
# schedules registered ("[worker] ready — dispatch:... aisdr:... signal-research:...")
# and, over time, jobs being processed, not just a boot line.

# End to end: sign in on the Vercel app (invited Clerk user), hit /admin as
# the super-admin id, run a quick-start discovery, and check /aisdr/review
# picks up drafts once the worker's cron ticks fire.
```

---

## Quick checklist

- [ ] Coolify Postgres: pgvector image (or extension pre-created), strong
      password, `sslmode=require`, public port enabled.
- [ ] Coolify scrapers (obscura/trafilatura/searxng, optional crawl4ai):
      per-service Base Directory + Dockerfile, public domain + TLS each.
- [ ] Coolify worker: `Dockerfile.worker`, no public domain, no healthcheck,
      env vars set (private `DATABASE_URL`, public scraper URLs,
      `WORKER_TARGET_URL` = Vercel domain, `WORKER_SECRET` set).
- [ ] Vercel app: env vars set (public `DATABASE_URL` with `sslmode=require`,
      public scraper URLs, real Clerk keys, `WORKER_SECRET` matching the
      worker, `SUPER_ADMIN_USER_IDS`).
- [ ] Migrations applied against the public `DATABASE_URL` (§5a).
- [ ] Real Clerk keys set; **Restricted** sign-up enabled in Clerk; Vercel
      domain added to Clerk's allowed origins.
- [ ] OpenRouter key-level credit limit set **and**
      `GLOBAL_WEEKLY_BUDGET_USD`/`GLOBAL_DAILY_BUDGET_USD` set on both
      Vercel and the Coolify worker.
- [ ] `WORKER_SECRET` identical on Vercel and the Coolify worker;
      `HARBINGER_SECRET` set (≥ 32 chars).
- [ ] Reviewed §6 — Postgres/scraper exposure is an accepted, understood
      tradeoff of this topology, not an oversight.
- [ ] `curl /api/metrics` → 200; worker logs show schedules registered and
      jobs processing.
