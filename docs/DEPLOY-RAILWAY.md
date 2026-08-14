# Deploying ChampHarbinger to Railway (full stack)

A step-by-step runbook to deploy the **entire** ChampHarbinger stack on
[Railway](https://railway.com) — the Next.js 16 web app, the standalone pg-boss
worker, Postgres (with the `vector` extension), and the self-hosted scraper
microservices (obscura, trafilatura, searxng, crawl4ai).

This mirrors the local `docker-compose.yaml`, but each compose service becomes
its **own Railway service**. Ollama and Prometheus are **optional** and omitted
from the default deploy.

> **Golden rules (from the Railway runbook):**
>
> 1. **Always select the Dockerfile builder** per service. Never let Railpack
>    autobuild — if you see `railpack` in a build log, the builder wasn't set.
> 2. **One Railway service per process.** App, worker, and each scraper are
>    separate services from the same repo.
> 3. **Apps must listen on `$PORT` and bind `0.0.0.0`.** (The app's Dockerfile
>    already sets `PORT=3000`/`HOSTNAME=0.0.0.0`; Railway overrides `PORT`.)
> 4. **`NEXT_PUBLIC_*` are build args**, baked into the client bundle at build
>    time. Set them before the first build; changing them requires a rebuild.

---

## 0. Service map

| Railway service         | Source                         | Builder / Dockerfile                  | Root Dir                   | Public domain | Healthcheck         |
| ----------------------- | ------------------------------ | ------------------------------------- | -------------------------- | ------------- | ------------------- |
| **app** (web)           | this repo                      | `Dockerfile`                          | repo root                  | **yes**       | `/api/metrics`      |
| **worker**              | this repo                      | `Dockerfile.worker`                   | repo root                  | no            | none                |
| **postgres**            | Railway DB / image             | `pgvector/pgvector:pg16`              | —                          | no            | managed             |
| **obscura**             | this repo                      | `services/obscura-gateway/Dockerfile` | `services/obscura-gateway` | no            | `/health` (9223)    |
| **trafilatura**         | this repo                      | `services/trafilatura/Dockerfile`     | `services/trafilatura`     | no            | `/health` (8001)    |
| **searxng**             | `searxng/searxng:latest` image | —                                     | —                          | no            | (none / `/healthz`) |
| **crawl4ai**            | this repo                      | `services/crawl4ai/Dockerfile`        | `services/crawl4ai`        | no            | `/health` (8000)    |
| _ollama_ (optional)     | `ollama/ollama:latest`         | —                                     | —                          | no            | —                   |
| _prometheus_ (optional) | `prom/prometheus:latest`       | —                                     | —                          | no            | —                   |

Put everything in **one Railway project** (one environment, e.g. `production`)
so the services share a private network. Only **app** needs a public domain.

Config-as-code already in the repo:

- `railway.toml` — app service (builder=Dockerfile, healthcheck `/api/metrics`).
- `railway.worker.toml` — worker service template (Dockerfile.worker, no
  healthcheck, runs the migration pre-deploy step).

---

## 1. Create the project and Postgres first

1. **New Project** in Railway. Name it `champ-harbinger` (or similar).
2. Add **Postgres with the `vector` extension**. Two options:
   - **Preferred — pgvector image:** New → **Docker Image** →
     `pgvector/pgvector:pg16`. Set service variables `POSTGRES_USER`,
     `POSTGRES_PASSWORD`, `POSTGRES_DB` (e.g. `harbinger` / a strong password /
     `champ_harbinger`). This image ships the `vector` extension, so migration
     `0008` (`CREATE EXTENSION IF NOT EXISTS "vector"`) just works.
   - **Or — Railway's managed Postgres plugin:** New → **Database → Add
     PostgreSQL**. Railway's Postgres supports pgvector, but the extension is
     **not** enabled by default. Before the first migration, open the service →
     **Data**/Query tab (or `psql`) and run once:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```
     (Migration `0008` also runs this, but it needs the extension to be
     _installable_ by the migration role — pre-running it confirms the image
     supports it and surfaces a permissions problem early.)

> Why this matters: migration **0008** creates `CREATE EXTENSION ... "vector"`,
> adds an `embedding vector(384)` column on `organizations`, and an HNSW index.
> If the `vector` extension can't be created, `pnpm db:migrate` fails and the
> deploy never becomes healthy.

The Postgres service exposes connection vars Railway templates can reference:
`${{Postgres.DATABASE_URL}}` (and `PGHOST`, `PGPORT`, etc.). Use the **private**
URL — Railway's `DATABASE_URL` already points at the internal `.railway.internal`
host, so app↔DB traffic stays on the private network (no egress fees).

---

## 2. Deploy the **app** (web) service

1. **New → GitHub Repo →** this repo. Railway creates a service; rename it
   **app**.
2. **Settings → Source:**
   - **Root Directory:** leave empty (repo root). The `Dockerfile`'s `COPY . .`
     needs the repo root as build context.
   - **Branch:** the branch you deploy from (e.g. `main`). To ship a feature
     branch, set it here per service.
3. **Settings → Build:**
   - **Builder = `Dockerfile`** (select explicitly).
   - **Dockerfile Path = `Dockerfile`**.
   - **Build Args** — add the build-time `NEXT_PUBLIC_*` (these are baked into
     the bundle, runtime env is ignored for them):
     - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your real Clerk publishable key
     - `NEXT_PUBLIC_HARBINGER_APP_URL` = the app's public URL (you can set this
       to the `*.up.railway.app` domain after step 2.5, then rebuild — or set
       your custom domain now if you know it)
     - `NEXT_PUBLIC_SENTRY_DSN` (optional), `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`
       (optional), `NEXT_PUBLIC_POSTHOG_HOST` (optional)
4. The repo's `railway.toml` sets the deploy config (healthcheck `/api/metrics`,
   timeout 300, restart ON_FAILURE). Confirm **Settings → Deploy →
   Healthcheck Path = `/api/metrics`** picked it up.
5. **Settings → Networking → Generate Domain** to get the
   `app-production-xxxx.up.railway.app` URL. (Or add a custom domain.)
6. Set the **app's runtime env vars** (next section), then **Deploy**.

### App runtime environment variables

Set these as **service variables** on the **app** service (not build args, except
the `NEXT_PUBLIC_*` ones noted above which are _both_ — set them in both Build
Args and, harmlessly, here):

```
# --- Database (private Railway URL) ---
DATABASE_URL=${{Postgres.DATABASE_URL}}

# --- Clerk (REAL keys — keyless mode does NOT work in production, see §6) ---
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx     # also a Build Arg (§2.3)
CLERK_SECRET_KEY=sk_live_xxx
CLERK_FRONTEND_API_DOMAIN=clerk.yourdomain.com    # your Clerk Frontend API domain

# --- LLM ---
OPENROUTER_API_KEY=sk-or-v1-xxx
HARBINGER_DEFAULT_MODEL=anthropic/claude-sonnet-4.6

# --- Internal service URLs (private networking, §5) ---
OBSCURA_GATEWAY_URL=http://obscura.railway.internal:9223
TRAFILATURA_BASE_URL=http://trafilatura.railway.internal:8001
SEARXNG_URL=http://searxng.railway.internal:8080
CRAWL4AI_BASE_URL=http://crawl4ai.railway.internal:8000

# --- Secrets / app config ---
HARBINGER_SECRET=<openssl rand -hex 16, >= 32 chars>
WORKER_SECRET=<openssl rand -hex 16>              # must MATCH the worker service
NEXT_PUBLIC_HARBINGER_APP_URL=https://<your-app-domain>   # also a Build Arg

# --- Multi-tenant / budgets / fairness (§7) ---
SUPER_ADMIN_USER_IDS=user_xxx                     # your Clerk user id, for /admin
GLOBAL_WEEKLY_BUDGET_USD=50                        # weekly instance cap
LLM_MAX_CONCURRENCY=12
FAIR_PER_USER_MAX=3
FAIR_GLOBAL_MAX=8
BOSS_FETCH_BATCH=20
BUDGET_CACHE_TTL_MS=45000
ENRICH_SET_CONCURRENCY=4

# --- Email infrastructure: InboxKit (domains + mailboxes) — see §9 ---
INBOXKIT_API_KEY=<from the InboxKit dashboard>
INBOXKIT_WORKSPACE_ID=<workspace uid>             # optional; auto-resolved if unset
INBOXKIT_WEBHOOK_SECRET=<openssl rand -hex 16>    # must match the secret set in InboxKit
INBOXKIT_CONTACT_EMAIL=admin@yourdomain.com       # WHOIS registrant (see §9)
INBOXKIT_CONTACT_FIRST_NAME=...
INBOXKIT_CONTACT_LAST_NAME=...
INBOXKIT_CONTACT_PHONE=+1.5555555555
INBOXKIT_CONTACT_ADDRESS=...
INBOXKIT_CONTACT_CITY=...
INBOXKIT_CONTACT_STATE=...
INBOXKIT_CONTACT_ZIP=...
INBOXKIT_CONTACT_COUNTRY=US

# --- Optional ---
HARBINGER_NODE_ENV=production
SENTRY_DSN=...                                    # optional
LAKEB2B_MOCK=true                                 # until the real LakeB2B API is wired
```

> **Do NOT set `DEV_AUTH_BYPASS` / `NEXT_PUBLIC_DEV_AUTH_BYPASS` on Railway.**
> They are local-only. Both are additionally gated on `NODE_ENV !== "production"`
> (which Railway sets), so Clerk auth stays active even if one leaks in — this is
> enforced by `src/lib/dev-auth.test.ts`. Real Clerk keys are still required.

> **`WORKER_SECRET` must be identical on app and worker.** The worker sends it as
> `X-Worker-Secret`; the app's internal job routes reject mismatches.

---

## 3. Deploy the **worker** (background) service

The worker is a **second service from the same repo** — it is NOT a thread inside
the app. It runs pg-boss schedules + job handlers and processes the fair-share
job queue.

1. **New → GitHub Repo →** the **same repo**. Rename the service **worker**.
2. **Settings → Source → Root Directory:** empty (repo root).
3. **Settings → Build:**
   - **Builder = `Dockerfile`**.
   - **Dockerfile Path = `Dockerfile.worker`**.
   - (Or point **Config-as-code → Railway Config File = `railway.worker.toml`**,
     which sets builder + dockerfile + the migration pre-deploy for you.)
4. **Settings → Networking:** do **not** generate a public domain. The worker is
   internal-only.
5. **Settings → Deploy → Healthcheck:** none (workers aren't HTTP-served).
6. **Pre-deploy / release command — run migrations here:**
   `pnpm db:migrate` (see §4). `railway.worker.toml` already declares this as
   `preDeployCommand`. If you configured the worker purely in the dashboard, set
   **Settings → Deploy → Pre-Deploy Command = `pnpm db:migrate`**.
7. **Env vars:** copy **all** of the app's runtime vars **except** the
   `NEXT_PUBLIC_*` build args. The worker specifically needs:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   OPENROUTER_API_KEY=sk-or-v1-xxx
   WORKER_SECRET=<same value as the app>
   WORKER_TARGET_URL=http://app.railway.internal:3000
   OBSCURA_GATEWAY_URL=http://obscura.railway.internal:9223
   TRAFILATURA_BASE_URL=http://trafilatura.railway.internal:8001
   SEARXNG_URL=http://searxng.railway.internal:8080
   CRAWL4AI_BASE_URL=http://crawl4ai.railway.internal:8000
   # fairness/budget knobs (same as app):
   FAIR_PER_USER_MAX=3
   FAIR_GLOBAL_MAX=8
   BOSS_FETCH_BATCH=20
   GLOBAL_WEEKLY_BUDGET_USD=50
   LLM_MAX_CONCURRENCY=12
   BUDGET_CACHE_TTL_MS=45000
   ENRICH_SET_CONCURRENCY=4
   # cron cadences (optional; defaults are sane):
   TRACKING_DISPATCH_CRON=*/5 * * * *
   OUTREACH_FOLLOWUPS_CRON=*/15 * * * *
   ```
   Tip: Railway lets you bulk-paste env vars (Raw Editor) — copy the app's set,
   drop the `NEXT_PUBLIC_*` lines, add `WORKER_TARGET_URL`.

> **`WORKER_TARGET_URL`** is how the worker reaches the app's internal job
> routes. Use the app's **private** domain: `http://app.railway.internal:3000`.

---

## 4. Running migrations

Migrations are Drizzle SQL files in `db/migrations`, applied by
`pnpm db:migrate` (= `drizzle-kit migrate`). They are **idempotent** — only
pending migrations run.

**Run them from the worker service, not the app.** `drizzle-kit` is a
**devDependency**. The app's standalone runner image (`.next/standalone`) only
bundles Next's traced runtime deps, so `drizzle-kit` is **absent** there and
`pnpm db:migrate` would fail with `drizzle-kit: not found`. The **worker** image
runs a full `pnpm install --frozen-lockfile`, so it _has_ drizzle-kit.

- **How:** worker service → **Settings → Deploy → Pre-Deploy Command =
  `pnpm db:migrate`** (already set if you used `railway.worker.toml`). Railway
  runs the pre-deploy command in a one-off container using the deploy's image and
  env **before** routing traffic to the new worker. With `DATABASE_URL` pointing
  at Postgres, migrations apply on every deploy.
- **Order:** make sure the `vector` extension is installable first (§1). On the
  very first deploy, if you used the managed-Postgres path, run
  `CREATE EXTENSION IF NOT EXISTS vector;` in the DB query console _before_
  triggering the worker deploy.
- **Only run it on one service.** Don't also add `pnpm db:migrate` to the app,
  to avoid two containers racing the same migration.

Manual fallback (if you prefer to gate migrations behind a button): leave the
pre-deploy command off and run, from the worker service's shell or a Railway
one-off:

```
pnpm db:migrate
```

---

## 5. Internal networking (Railway private domains)

Railway gives every service a private domain `<service-name>.railway.internal`,
reachable only inside the project's private network (IPv6). App + worker talk to
Postgres and the scrapers over these — no public exposure, no egress cost.

Set these on **both app and worker** (the scraper URLs) and on **app** (the DB):

| Variable                          | Value                                           |
| --------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`                    | `${{Postgres.DATABASE_URL}}` (already internal) |
| `OBSCURA_GATEWAY_URL`             | `http://obscura.railway.internal:9223`          |
| `TRAFILATURA_BASE_URL`            | `http://trafilatura.railway.internal:8001`      |
| `SEARXNG_URL`                     | `http://searxng.railway.internal:8080`          |
| `CRAWL4AI_BASE_URL`               | `http://crawl4ai.railway.internal:8000`         |
| `WORKER_TARGET_URL` (worker only) | `http://app.railway.internal:3000`              |

> The internal hostname is the **service name** you set in the dashboard. If you
> named the search service `searxng`, the host is `searxng.railway.internal`.
> Match the names you actually use. Internal traffic is plain HTTP on the
> service's listen port (no TLS needed inside the private network).

### Deploy the scraper services

Each scraper is a separate Railway service from this repo, built from its
subfolder Dockerfile. For each one:

- **New → GitHub Repo →** this repo, then **Settings → Source → Root Directory =
  the service subfolder** (this sets the build context so the Dockerfile's
  relative `COPY` lines resolve), **Settings → Build → Builder = Dockerfile**,
  **Dockerfile Path = `Dockerfile`**.
- **No public domain** (internal-only).

| Service         | Root Directory             | Dockerfile Path | Internal port | Notes                                                                       |
| --------------- | -------------------------- | --------------- | ------------- | --------------------------------------------------------------------------- |
| **obscura**     | `services/obscura-gateway` | `Dockerfile`    | 9223          | Node gateway over the `obscura` binary; `EXPOSE 9223`, `/health`            |
| **trafilatura** | `services/trafilatura`     | `Dockerfile`    | 8001          | FastAPI/uvicorn, binds `0.0.0.0:8001`, `/health`                            |
| **crawl4ai**    | `services/crawl4ai`        | `Dockerfile`    | 8000          | FastAPI + Playwright/Chromium (heavy image; see §8 build memory), `/health` |

**SearXNG** uses the upstream image plus this repo's `services/searxng/settings.yml`:

- **New → Docker Image → `searxng/searxng:latest`**, service name `searxng`.
- The app needs SearXNG's **JSON** output format enabled (the repo's
  `settings.yml` sets `formats: [html, json]`). Two ways to apply it on Railway:
  - **Recommended:** set the env var **`SEARXNG_SETTINGS_PATH`** and mount a
    volume, OR bake a tiny custom image — but the simplest path that needs no
    volume is to set these env vars on the searxng service:
    ```
    SEARXNG_BASE_URL=http://searxng.railway.internal:8080/
    SEARXNG_SECRET=<openssl rand -hex 32>
    ```
    and, because the stock image disables JSON, ship a one-line override by
    building searxng from a 3-line Dockerfile in the repo that `COPY`s
    `services/searxng/settings.yml` into `/etc/searxng/settings.yml`. If you'd
    rather not, attach a **Volume** mounted at `/etc/searxng` and upload
    `settings.yml` there.
  - Set the **internal port** Railway should target to **8080** (SearXNG's
    default). No public domain.
- Update the placeholder `secret_key` in `settings.yml` (or override via
  `SEARXNG_SECRET`) — never ship the committed `champharbinger-change-me`.

> The scrapers degrade gracefully: if `CRAWL4AI_BASE_URL`/etc. are unset, those
> chat tools return a "not configured" message rather than crashing. You can
> deploy app+worker+Postgres first, confirm health, then add scrapers.

---

## 6. Clerk (production auth) — keyless mode does NOT work in production

**State plainly: Clerk Keyless mode is a local-dev convenience only. It will NOT
work on Railway.** In production you MUST provision a real Clerk application and
set real keys, or auth will be broken/insecure.

1. In the [Clerk dashboard](https://dashboard.clerk.com), create (or select) a
   **production** instance for your domain.
2. Copy from **API Keys**:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → set as a **Build Arg** _and_ a runtime
     var on the **app** service (it's inlined into the client bundle at build).
   - `CLERK_SECRET_KEY` → runtime var on the **app** service only.
   - `CLERK_FRONTEND_API_DOMAIN` → your Clerk **Frontend API** domain (e.g.
     `clerk.yourdomain.com`). Required for the production instance.
3. **Allowed origins / domains:** add your `*.up.railway.app` (and custom) domain
   in Clerk so sign-in works from the deployed origin.
4. **Restricted (invite-only) sign-up — dashboard step:** Clerk dashboard →
   **User & Authentication → Restrictions → Sign-up mode = `Restricted`**. This
   makes the instance **invite-only**: new users can't self-register; you invite
   them from Clerk → Users → Invite. This is the intended posture for the shared
   ChampHarbinger instance.
5. Keep the route-URL vars at their defaults (`/login`, `/signup`, `/dashboard`)
   unless you've moved those routes — they're already in `.env.example`.

> If `CLERK_SECRET_KEY` is missing, auth routes break and protected pages won't
> render correctly. Set all three Clerk vars before the first real login.

---

## 7. Budgets, the weekly cap, and the admin console

ChampHarbinger runs as a **shared, invite-only multi-tenant** instance on one
OpenRouter key. Protect that key with **two independent caps** plus fairness
knobs.

### 7a. OpenRouter key-level credit limit (hard backstop)

In the **OpenRouter dashboard → Keys**, edit the key used as
`OPENROUTER_API_KEY` and set a **credit limit** on it (OpenRouter enforces this
server-side — once the key has spent its limit, OpenRouter rejects further
calls regardless of app state). This is your hard ceiling that survives any app
bug. Size it to your weekly budget plus a small margin, and top up / reset on
your billing cadence.

### 7b. In-app weekly-resetting cap (`GLOBAL_WEEKLY_BUDGET_USD`)

Set `GLOBAL_WEEKLY_BUDGET_USD` (e.g. `50`) on **app and worker**. The budget
guard tallies trailing-week spend and **blocks new paid work at coarse entry
points** (heavy job intake + chat) once the instance is at/over the cap, then
resets as the weekly window rolls forward. This is the soft, self-resetting cap;
the OpenRouter key limit (7a) is the hard backstop. Leave blank/0 for unlimited
(not recommended for a shared instance).

Per-user and per-team weekly caps are managed at runtime from the admin console
(below); `GLOBAL_WEEKLY_BUDGET_USD` is the instance-wide one set via env.

### 7c. Fairness / concurrency knobs

All have safe defaults (documented in `.env.example`); override only to tune:

| Var                      | Default | Effect                                                                             |
| ------------------------ | ------- | ---------------------------------------------------------------------------------- |
| `LLM_MAX_CONCURRENCY`    | 12      | Max parallel in-flight LLM calls per process (semaphore; prevents OpenRouter 429s) |
| `FAIR_PER_USER_MAX`      | 3       | Max concurrent heavy jobs per user (worker fair-share)                             |
| `FAIR_GLOBAL_MAX`        | 8       | Global ceiling on concurrent heavy jobs                                            |
| `BOSS_FETCH_BATCH`       | 20      | pg-boss jobs pulled per poll                                                       |
| `BUDGET_CACHE_TTL_MS`    | 45000   | TTL of the cached spend tally (avoids per-request DB hits)                         |
| `ENRICH_SET_CONCURRENCY` | 4       | Parallel enrichments within one waterfall set                                      |

> **Multi-instance caveat:** `LLM_MAX_CONCURRENCY` and the budget cache are
> **per-process**. If you scale the app to multiple replicas, each replica gets
> its own semaphore and cache, so the effective concurrency multiplies. Keep the
> app at **1 replica** (and the worker at 1) unless/until these move to a shared
> Redis token bucket. The OpenRouter key limit (7a) still bounds total spend
> regardless.

### 7d. Super-admin access to `/admin`

Set `SUPER_ADMIN_USER_IDS` to **your Clerk user id** (pipe-separated for
multiple) on the **app** service. Only those ids can reach `/admin` (team/budget
management, pause switches); everyone else gets 403. Find your id in Clerk →
Users. Leaving it blank locks everyone out of `/admin` in production.

---

## 8. Triage — common Railway gotchas

Match the symptom; full triage tree is in the `railway-deployment` skill.

### Build phase

- **`Railpack could not determine how to build the app`** — the Dockerfile
  builder wasn't selected. Fix: service → **Settings → Build → Builder =
  Dockerfile**, set the right **Dockerfile Path**, and (for the scrapers) set
  **Root Directory** to the service subfolder so Railway finds the Dockerfile.
- **`COPY ... : file not found`** — build-context mismatch. The scraper
  Dockerfiles use relative copies (`COPY app.py ./`), so **Root Directory must be
  the service subfolder** (`services/trafilatura`, etc.). The app/worker
  Dockerfiles `COPY . .` from the **repo root**, so their Root Directory must be
  empty.
- **`dockerfile invalid: flag '--mount=type=cache' is missing an id argument`**
  (Railway Metal builder) — strip BuildKit cache mounts. None of this repo's
  Dockerfiles currently use them, but if you add one, remove the
  `--mount=type=cache,...` flag (it's only a speed optimization).
- **Build OOM / hangs** — most likely **crawl4ai** (Playwright + Chromium is a
  large image). It already uses `pip --no-cache-dir`. If it OOMs on the Hobby
  plan's ~4GB build cap, deploy it on a plan with more build memory, or skip
  crawl4ai initially (the bulk-crawl tools degrade to "not configured").

### Runtime phase

- **Healthcheck failed (app)** — Railway GETs `/api/metrics` and needs HTTP
  **200**. That route is unauthenticated and DB-fault-tolerant (its DB read is
  in a try/catch), so a cold Postgres won't fail it. If it still fails:
  - Confirm **Healthcheck Path = `/api/metrics`** (not `/`), timeout **300**.
  - Confirm the app bound `$PORT` — the Dockerfile sets `HOSTNAME=0.0.0.0` and
    Next reads `PORT`; don't override the start command.
  - Read the first ~20 deploy log lines — a crash on boot (missing
    `CLERK_SECRET_KEY`, bad `DATABASE_URL`) shows there.
- **`$PORT` literal error** — only happens if you override the start command in
  exec form. The shipped `CMD ["node","server.js"]` reads `process.env.PORT`
  natively, so leave it alone. If you ever wrap it, use `sh -c '... ${PORT}'`.
- **App listening on `127.0.0.1`** — Railway's healthcheck is external to the
  container; the app already binds `0.0.0.0` via `HOSTNAME`. Don't change it.
- **Container exits on boot** — read the log's first lines:
  - missing `DATABASE_URL` / `OPENROUTER_API_KEY` → set the service var.
  - `vector` extension errors during migrate → §1 (use pgvector image or
    pre-create the extension).
  - Clerk init errors → set the real Clerk keys (§6).
- **Worker not processing jobs** — confirm it's a **separate service** running
  `Dockerfile.worker` (`pnpm worker`), shares `DATABASE_URL` and `WORKER_SECRET`
  with the app, and that `WORKER_TARGET_URL=http://app.railway.internal:3000`.
  Worker logs should show jobs processed, not just "starting worker".
- **Migrations didn't run** — they're the worker's pre-deploy step; the app
  can't run them (no drizzle-kit in the standalone image — §4). Check the
  worker's pre-deploy logs.
- **Scraper calls fail from app/worker** — verify the internal URLs match the
  actual service names (`<name>.railway.internal`) and ports (9223/8001/8080/
  8000). Internal traffic is plain HTTP.

### Verify it's live

```bash
# App healthcheck (replace with your domain):
curl -s -o /dev/null -w "%{http_code}\n" https://<app-domain>/api/metrics   # → 200

# Build log driver should say "dockerfile", never "railpack".
# Worker logs should show pg-boss jobs being processed.
# Open the app, sign in (invited Clerk user), hit /admin as the super-admin id.
```

---

## 9. InboxKit — email infrastructure (domains + mailboxes)

InboxKit powers **Settings → InboxKit**: domain search, combined
domain+mailbox orders, and the domain-health signal that
`src/lib/sequencing/guardrails.ts` fail-closes sending on.

### 9.1 API shape (verified live — don't "fix" it back)

`src/lib/email-infra/inboxkit.ts` looks unusual for a REST client because the
real API is unusual. All of this was confirmed against `api.inboxkit.com`:

| Thing       | Value                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Base URL    | `https://api.inboxkit.com/v1/api` — **bare `/v1` 404s**                              |
| List/search | **POST** (`/domains/list`, `/domains/search`, `/mailboxes/list`, `/orders`)          |
| Some reads  | GET with query params (`/dns/list?domain=`, `/mailboxes/show-credentials?email=`)    |
| Workspace   | `X-Workspace-Id` header **required**; omitting it → `400 "Workspace ID is required"` |
| Envelope    | `{error:false, message, domains                                                      | mailboxes:[...]}`; failures can arrive as **HTTP 200 with `error:true`** |
| Domain rows | name is `name` (not `domain`); `price` is a number (USD/yr)                          |
| TLDs        | only `.com/.net/.org/.shop` are purchasable; `price: 0` = unsellable                 |

`INBOXKIT_WORKSPACE_ID` is optional in config: when unset the client calls
`/workspaces/list` once and caches the first workspace uid. Set it explicitly
if the team has more than one workspace.

### 9.2 Registrant (WHOIS) details

`create_order` requires contact details. The code has **placeholder defaults**
(`INBOXKIT_CONTACT_*` in `.env.example`) — set the real registrant on the app
service before ordering domains in production, or domains get registered
against placeholder WHOIS data.

### 9.3 Webhook (required for mailboxes to become usable)

InboxKit provisions asynchronously and reports readiness via a webhook. Until
it fires, `/api/webhooks/inboxkit` never imports credentials, so ordered
mailboxes stay unusable for sequencing.

1. Deploy the app and note its public URL.
2. In InboxKit, set the account webhook to
   `https://<your-app-domain>/api/webhooks/inboxkit`.
3. Set the same shared secret in InboxKit and as `INBOXKIT_WEBHOOK_SECRET` on
   app + worker. The route compares it in constant time; **if the env var is
   unset the route accepts unsigned posts** (dev convenience) — always set it
   in production.

> The webhook URL is account-wide and single-valued: pointing it at Railway
> **replaces** whatever was there. If it currently points at a local
> `trycloudflare.com` tunnel from local testing, that tunnel stops receiving
> events once you switch it.

### 9.4 Credits

Ordering spends InboxKit credits (~$3.99/mailbox + domain registration). Check
`GET /v1/api/account` → `credits_remaining`. **With 0 credits, search works but
every order fails at payment** — so verify credits before treating ordering as
broken.

---

## 10. Optional services (not in the default deploy)

- **Ollama** — only if you want classification workloads off OpenRouter. Deploy
  `ollama/ollama:latest` as a service, attach a volume at `/root/.ollama`, pull a
  model (`ollama pull llama3.1:8b`), and set `OLLAMA_BASE_URL=
http://ollama.railway.internal:11434` on app+worker. Heavy; needs real CPU/RAM.
- **Prometheus** — the app already exposes `/api/metrics`. Deploy
  `prom/prometheus:latest` with a config scraping `app.railway.internal:3000`
  only if you want a self-hosted metrics store / Grafana source.

---

## Quick checklist

- [ ] Postgres up, `vector` extension installable (pgvector image or
      `CREATE EXTENSION`).
- [ ] **app** service: Dockerfile builder, healthcheck `/api/metrics`, public
      domain, `NEXT_PUBLIC_*` build args + runtime env set.
- [ ] **worker** service: `Dockerfile.worker`, no public domain, no healthcheck,
      pre-deploy `pnpm db:migrate`, env copied (minus `NEXT_PUBLIC_*`, plus
      `WORKER_TARGET_URL`).
- [ ] scrapers (obscura/trafilatura/searxng/crawl4ai): per-service Root
      Directory + Dockerfile, internal-only, internal URLs wired into app+worker.
- [ ] Real Clerk keys set; **Restricted** sign-up enabled in Clerk.
- [ ] OpenRouter key-level credit limit set **and** `GLOBAL_WEEKLY_BUDGET_USD`.
- [ ] `SUPER_ADMIN_USER_IDS` = your Clerk user id (for `/admin`).
- [ ] `WORKER_SECRET` identical on app and worker; `HARBINGER_SECRET` set
      (≥ 32 chars).
- [ ] `DEV_AUTH_BYPASS` / `NEXT_PUBLIC_DEV_AUTH_BYPASS` **not** set on Railway.
- [ ] InboxKit (§9): `INBOXKIT_API_KEY` set, `INBOXKIT_CONTACT_*` set to the
      real registrant, webhook pointed at
      `https://<app-domain>/api/webhooks/inboxkit` with `INBOXKIT_WEBHOOK_SECRET`
      matching on both sides, and credits available for ordering.
- [ ] `curl /api/metrics` → 200; build log says `dockerfile`, not `railpack`.
