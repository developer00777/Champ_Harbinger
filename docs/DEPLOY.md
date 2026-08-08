# Deploy — ChampHarbinger (Vercel + Deepify/Coolify)

**Supersedes `HANDOFF-BACKEND-DEPLOY.md` and `HANDOFF-FRONTEND-DEPLOY.md`.** Those documents
described a _proxy split_ (Vercel forwarding `/api/*` to a full second copy of the app on
Coolify). That mode is retired — the droplet that hosted the backend copy **cannot run
`next build`** (two attempts took the whole multi-tenant host down; see §6b) and it left
Vercel's own env vars as dead placeholders, which is exactly backwards from the goal below.

**The goal, stated by the product owner:** _"I just need to be able to put in the API keys in
the Vercel environment variables, and that's it."_ Everything in this document exists to make
that literally true.

---

## 0. The architecture

ChampHarbinger is **ONE Next.js 16 application** — pages and API routes share a codebase, and
the UI fetches its own API with relative paths (`fetch("/api/...")`).

**Workload split** (current mode):

- **Vercel runs the whole app** — pages _and_ `/api/*`. This is the single place API keys live.
  `HARBINGER_API_ORIGIN` is **unset**, so `next.config.ts` installs no proxy rewrite and Vercel
  serves its own routes.
- **Coolify runs everything Vercel can't host**: the pg-boss **worker** (schedules + background
  jobs — discovery, enrichment, mailbox sync, signal research, tracking), **Postgres**, and the
  4 scraper microservices (SearXNG, Trafilatura, Crawl4AI, Obscura).

The wrinkle: the worker runs discovery/enrichment/etc. **inline**
([`src/lib/jobs/workers/index.ts`](../src/lib/jobs/workers/index.ts)), on a different host than
Vercel, so it needs the same provider keys (OpenRouter, PDL, InboxKit, Coresignal, …). Rather
than keeping a second copy of those keys on Coolify, **the worker pulls them from the app**:

- `GET /api/internal/worker-config` on the Vercel app
  ([route.ts](../src/app/api/internal/worker-config/route.ts)) — guarded by the `x-worker-secret`
  header, returns an explicit allowlist of provider config, 404s if `WORKER_SECRET` is unset.
- [`src/lib/jobs/worker-config.ts`](../src/lib/jobs/worker-config.ts) — the worker calls this on
  boot and every ~60s, writing only the allowlisted keys into its own `process.env`. A fetch
  failure keeps the last-good bundle; it never crashes the worker.

Net effect: **rotate a key in Vercel and the worker picks it up within a minute — no worker
redeploy.** Infra secrets (`DATABASE_URL`, `WORKER_SECRET`, `HARBINGER_SECRET`,
`CLERK_SECRET_KEY`) are never in that allowlist and never leave their own host.

---

## 1. Access

- **Coolify API token:** `/Users/deep/Celsus/Other/.secrets/deepify_api_token`
  (scopes read/write/deploy, expires 2026-10-20). Base URL
  `https://deepify.64.227.154.215.sslip.io/api/v1`.
- **SSH:** `root@64.227.154.215` (key-based, already trusted from this machine).
- **Project:** `champ-paas` = `iigefdubncwe3tnnve6dc2sd`, env `production` =
  `k676vpqobylpr7g2bdbq2q57`, server = `jky22zgqxfy2po9ncm8ravtr`.
- **Repo:** `git@github.com:Champ-Deep/ChampHarbinger.git` (**private**). Coolify authenticates
  with a read-only deploy key registered as Coolify private key `j135welfw946vhwq9vf9idsc`.
- **Vercel project:** `champharbinger` · `prj_bQM3AVhCYOAwzwMd9CigdHEsaEL4`, team
  `deep-5245s-projects` · `team_kajWE2CV5A7yoQZO3T6IqZ3l`. Framework preset `nextjs`, Node 22.x,
  root directory `.`.

---

## 2. Live components

| Component                                  | Host                                 | Notes                                           |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------- |
| App (pages + `/api/*`)                     | Vercel — `champharbinger.vercel.app` | serves everything; `HARBINGER_API_ORIGIN` unset |
| Worker (pg-boss)                           | Coolify `t3rvmysx0fpzx4w0qkelscju`   | no domain; pulls keys from Vercel (§0)          |
| Postgres + pgvector                        | Coolify `yyjp3isodylbx9vggfpkw8hq`   | port 5432 → public 5470                         |
| searxng / trafilatura / crawl4ai / obscura | Coolify, gated                       | secret path prefix, see §6g                     |
| ~~Backend app copy~~                       | Coolify `mf77xhhooz096hljmyx6v7hq`   | **stopped**, not deleted — see §3               |

The old full-app "backend" Coolify application (`champharbinger-backend`,
`mf77xhhooz096hljmyx6v7hq`) is **stopped, not deleted**, in case a rollback to proxy mode is
ever needed. It should never build again — that's what took the droplet down.

---

## 3. Deploy — Vercel (the only place keys go)

**a) Never deploy from a working directory.** `vercel deploy` uploads your _current working
directory_, not a commit — this has already caused a production outage (16-hour-old code from a
branch shipped silently). Deploy from a clean checkout of merged `main`, or connect the Vercel
project to GitHub and deploy from there.

```bash
git status --short          # must be empty
git rev-parse --short HEAD  # record this; it is what you are shipping
```

**b) Environment variables — Production:**

| Var                                                                               | Notes                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                                                                    | Coolify Postgres, `?sslmode=require` (see §6e)             |
| `OPENROUTER_API_KEY`                                                              | the whole point — set this and every AI feature works      |
| `HARBINGER_DEFAULT_MODEL`                                                         | optional override                                          |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_*`                                         | auth                                                       |
| `WORKER_SECRET`                                                                   | shared secret with the Coolify worker — must match         |
| `HARBINGER_SECRET`                                                                | BYOK encryption key — must match the worker                |
| `NEXT_PUBLIC_HARBINGER_APP_URL`                                                   | `https://<this vercel domain>`                             |
| `SEARXNG_URL`, `TRAFILATURA_BASE_URL`, `CRAWL4AI_BASE_URL`, `OBSCURA_GATEWAY_URL` | API routes call scrapers directly now (they run on Vercel) |
| `SUPER_ADMIN_USER_IDS`                                                            | Clerk user id(s), comma-separated                          |
| `PDL_API_KEY`, `APOLLO_API_KEY`, `LAKEB2B_API_KEY`, `CORESIGNAL_API_KEY`          | optional, per provider — see §4                            |
| `INBOXKIT_API_KEY`, `INBOXKIT_WORKSPACE_ID`                                       | optional, outbound infra                                   |

**MUST stay unset:** `HARBINGER_API_ORIGIN` (re-enabling it turns the proxy back on).

`NEXT_PUBLIC_*` values are inlined at build time — changing one needs a rebuild, not a restart.

**c) Deploy:** `vercel --prod` from the clean checkout, or push to `main` if Git-connected.

---

## 4. Coresignal — the last key to add

Coresignal is a **plug-and-play stand-in for LakeB2B** — testing the discovery + enrichment
pipeline without a LakeB2B contract. It slots into the exact same seam
([`DiscoveryProvider`](../src/lib/discovery/types.ts)):

- Add `CORESIGNAL_API_KEY` to Vercel (or a user pastes it under Settings → Keys — BYOK works the
  same way as every other provider).
- Discovery picks it automatically: LakeB2B key present → LakeB2B wins; otherwise Coresignal key
  present → Coresignal; otherwise SearXNG-only public-web; otherwise fixture mock data (loudly
  warned). See [`getDiscoveryProvider`](../src/lib/discovery/index.ts).
- The moment a real `LAKEB2B_API_KEY` is added, LakeB2B takes over again automatically — no code
  change, no toggle to flip.
- Enrichment gap-fill: [`CoresignalAdapter`](../src/lib/enrichment/providers/coresignalAdapter.ts)
  runs at the same paid-tier waterfall slot PDL occupies, ranked just ahead of it — with a
  Coresignal key configured it fills contact fields PDL would otherwise fill.
- No key = fully dormant on both paths, zero calls, zero cost.

---

## 5. Deploy — Coolify worker

1. **Env (infra only — no provider keys here):**
   - `DATABASE_URL` — non-TLS local URL (`64.227.154.215:5470`, no `sslmode`); see §6e for why.
   - `WORKER_TARGET_URL` — `https://<vercel-domain>` (used to reach both `/api/internal/worker-config`
     and the internal job-trigger routes it already called, e.g. `/api/outreach/process`).
   - `WORKER_SECRET`, `HARBINGER_SECRET` — must match Vercel.
   - Scraper URLs (`SEARXNG_URL`, `TRAFILATURA_BASE_URL`, `CRAWL4AI_BASE_URL`, `OBSCURA_GATEWAY_URL`).
   - Optional cron overrides (`TRACKING_DISPATCH_CRON`, etc.).
2. Deploy (worker image is a plain Node build — safe on this droplet, unlike `next build`):
   ```bash
   TOKEN=$(cat /Users/deep/Celsus/Other/.secrets/deepify_api_token)
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://deepify.64.227.154.215.sslip.io/api/v1/deploy?uuid=t3rvmysx0fpzx4w0qkelscju&force=true"
   ```
3. Confirm the worker-config pull is working:
   ```bash
   ssh root@64.227.154.215 'docker logs --tail 20 $(docker ps --filter name=^t3rv --format "{{.Names}}" | head -1)'
   ```
   Look for `[worker] ready — ...` with no repeated `[worker-config] fetch error` lines.

---

## 6. Verification — do not skip

**a) `/api/*` is actually served by Vercel**, not a stale proxy:

```bash
curl -s https://champharbinger.vercel.app/api/metrics | grep "^harbinger_process_start_time_seconds "
```

This should reflect the Vercel deploy time, not a droplet uptime. (This exact check — comparing
`harbinger_process_start_time_seconds` across origins — is what caught the proxy silently never
firing during the earlier `afterFiles`/`beforeFiles` bug.)

**b) Pages render:**

```bash
for p in / /login /dashboard /results /settings; do
  printf "%-12s " $p; curl -s -o /dev/null -w "%{http_code}\n" https://champharbinger.vercel.app$p
done
```

**c) A DB-backed route actually executes:**

```bash
curl -s -H "x-worker-secret: $WORKER_SECRET" https://champharbinger.vercel.app/api/tracking/dispatch
# → {"dispatched":0,"total":0}  proves Postgres connectivity end-to-end
```

**d) `/api/internal/worker-config` auth is correct:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://champharbinger.vercel.app/api/internal/worker-config
# → 404 (no secret header)
curl -s -o /dev/null -w "%{http_code}\n" -H "x-worker-secret: $WORKER_SECRET" \
  https://champharbinger.vercel.app/api/internal/worker-config
# → 200
```

**e) End-to-end, signed in:** agent chat answers (proves `OPENROUTER_API_KEY` from Vercel is
live), Quick-Start discovery returns 202 and a worker log line shows
`quick-start-discover: N companies, ...`, and `/results` renders with a Select dropdown opened
without a `Base UI error #31` crash.

**f) Key rotation propagates:** change a dummy allowlisted var in Vercel (e.g.
`HARBINGER_DEFAULT_MODEL`), redeploy, and within ~60s confirm the worker log or a fresh
`worker-config` fetch reflects it — no worker redeploy needed.

---

## 7. Environment landmines — read before touching anything

**a) Never run more than one build at a time on the droplet. It is multi-tenant.**
On 2026-07-30, four `next build` runs in quick succession exhausted memory on this 3.9 GB
droplet and took the **entire host** down at the service level for ~20 minutes — SSH, the
Coolify dashboard, and other tenants (`champbeam`, `champdf`, `event-scout`) all went dark while
still answering ping. The backend app copy has since been proven to reliably fail `next build`
on this box (aborted twice, memory fell as low as 204 MB available) — that's why it's stopped
rather than redeployed. The worker's build (plain `tsx`/Node, no Next.js compile) is much
lighter and has not caused this.

**b) Coolify's Traefik proxy has NEVER run here. Host nginx owns 80/443.**
Do not start the Coolify proxy and do not stop nginx. Every app domain is an nginx vhost with a
per-domain certbot cert, managed via `/root/deepify-add-domain.sh` — never hand-write a vhost
(a hand-written one isn't in the auto-heal registry and 502s after the next redeploy).

**c) Postgres driver asymmetry.** The app uses `postgres.js`, which accepts the self-signed cert
under `?sslmode=require`. `pg` (node-postgres, used by Drizzle migrations and pg-boss) does
**not** — it fails with `DEPTH_ZERO_SELF_SIGNED_CERT`. So: migrations need
`?sslmode=no-verify`; the worker (on-box) uses a non-TLS local URL; anything off-box (Vercel)
uses `?sslmode=require`.

**d) Coolify env-var backslash bug.** A value containing `\.` set via `/envs/bulk` can arrive
double-escaped inside the container. Avoid backslashes in regex-valued env vars; use a bracketed
class (`[.]`) instead.

**e) Scrapers are gated behind secret path prefixes.** Their sslip.io domains are discoverable
via certificate-transparency logs and are stateless fetch/render/search proxies — unguarded they
are open proxies. Each nginx vhost only serves `location ^~ /<token>/` and 404s everything else;
the token lives in the URL already stored in the relevant env var. Do not "fix" the 404 at the
domain root.

---

## 8. Rollback (back to proxy mode)

Only if the split itself is the problem:

1. Restart the stopped backend app (`mf77xhhooz096hljmyx6v7hq`) — **do not** trigger a build on
   the droplet; restart the last successful image if one exists, or accept that a fresh build
   there is unreliable (§7a).
2. Set `HARBINGER_API_ORIGIN` on Vercel back to the backend's URL.
3. Remove `DATABASE_URL`/`OPENROUTER_API_KEY`/other backend-only vars from Vercel (they become
   dead weight again in proxy mode, not a security issue, just pointless).

This is a last resort — it reintroduces the exact problem this document exists to close.

---

## 9. Definition of done

- [ ] Vercel: `HARBINGER_API_ORIGIN` unset, `DATABASE_URL` + `OPENROUTER_API_KEY` real, deployed
      from a clean `main` checkout
- [ ] Coolify backend app copy stopped (not deleted)
- [ ] Coolify worker on `WORKER_TARGET_URL` pointed at the Vercel domain, `WORKER_SECRET` +
      `HARBINGER_SECRET` matching
- [ ] §6 checks a–f all pass
- [ ] Team can sign in, run a campaign, and everything (LLM, discovery, InboxKit) works from
      Vercel env vars alone
