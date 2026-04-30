# ChampHarbinger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up ChampHarbinger — Champions Group's rebrand and rearchitecture of Signal (jay-sahnan/signal) — running locally on vanilla Postgres + Clerk + OpenRouter, then deployed to Railway for staging tests.

**Architecture:** Big-bang rebrand + DB swap executed in five parallel streams (DB layer, branding, LLM provider, integrations + monitoring, marketing) on isolated git worktrees, bracketed by a sequential bootstrap step and a sequential merge/verify step. Final phase deploys to Railway with managed Postgres.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, Drizzle ORM, postgres.js, Clerk, OpenRouter via Vercel AI SDK, Sentry, Prometheus, Docker Compose, Railway.

**Reference spec:** `docs/superpowers/specs/2026-04-30-champ-harbinger-design.md`

---

## Working directory

All paths are relative to `/Users/deep/Apps&Projects/ChampHarbinger/` unless noted. The directory is already created and contains the spec on `main`. All shell commands assume this is `cd`'d.

## Identity for git commits

```bash
git config user.name "Deep"
git config user.email "deep@championsmail.com"
```

(Commits should also include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` per repo convention.)

---

# Phase 0 — Bootstrap

Sequential. One agent. Foundation for the parallel streams.

## Task 1: Download Signal source into the repo

**Files:**
- Modify: `/Users/deep/Apps&Projects/ChampHarbinger/` (extract Signal source on top of existing `docs/`)

- [ ] **Step 1: Verify the working dir is clean and contains only the spec**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger" && git status && git log --oneline
```

Expected: `main` clean; two commits (the spec + Railway update); only `docs/` directory.

- [ ] **Step 2: Download Signal source as a tarball (no .git history)**

```bash
curl -L https://github.com/jay-sahnan/signal/archive/refs/heads/main.tar.gz -o /tmp/signal-src.tar.gz
mkdir -p /tmp/signal-extract
tar -xzf /tmp/signal-src.tar.gz -C /tmp/signal-extract
ls /tmp/signal-extract/
```

Expected: a single directory like `signal-main/` listed.

- [ ] **Step 3: Copy Signal source into the repo (preserves docs/)**

```bash
SRC_DIR=$(ls /tmp/signal-extract/ | head -1)
rsync -a --exclude='.git' "/tmp/signal-extract/$SRC_DIR/" "/Users/deep/Apps&Projects/ChampHarbinger/"
ls -la /Users/deep/Apps\&Projects/ChampHarbinger/
```

Expected: Signal's directories (`app/`, `src/`, `supabase/`, etc.) plus our `docs/` directory.

- [ ] **Step 4: Inspect what was downloaded**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger"
cat package.json | head -30
ls app/ src/ 2>/dev/null
find . -name '*.ts' -o -name '*.tsx' | grep -v node_modules | wc -l
```

Note the structure for later tasks. Capture these in your working notes:
- Where do `@supabase/*` clients get instantiated? (Stream A needs this)
- Where do `@ai-sdk/anthropic` calls happen? (Stream C needs this)
- Where is AgentMail used? (Stream D needs this)
- What does the marketing/landing surface look like? (Stream E needs this)

- [ ] **Step 5: Commit the raw Signal source**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Import Signal source from jay-sahnan/signal main

Raw vendor import. All rebrand, DB swap, LLM swap, and monitoring
work happens in subsequent commits via parallel streams on worktrees.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Replace package.json with new name and updated deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read the current package.json**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger" && cat package.json
```

Note: existing dependencies, the package name (`signal` or similar), version, scripts. We will preserve scripts and most deps; we only change the name and swap a few packages.

- [ ] **Step 2: Edit package.json — rename package and remove banned deps**

Apply these changes:
- `"name": "..."` → `"name": "champ-harbinger"`
- Remove (if present): `@supabase/supabase-js`, `@supabase/ssr`, `@supabase/auth-helpers-nextjs`, `agentmail`, `@agentmail/sdk`, `@ai-sdk/anthropic`
- Add (under `dependencies`):
  - `"drizzle-orm": "^0.36.0"`
  - `"postgres": "^3.4.0"`
  - `"@openrouter/ai-sdk-provider": "^0.0.6"`
  - `"@sentry/nextjs": "^8.0.0"`
  - `"prom-client": "^15.1.3"`
  - `"zod": "^3.23.8"` (if not already present — used for env var validation)
- Add (under `devDependencies`):
  - `"drizzle-kit": "^0.28.0"`
- Add (under `scripts`):
  - `"db:generate": "drizzle-kit generate"`
  - `"db:migrate": "drizzle-kit migrate"`
  - `"db:push": "drizzle-kit push"`
  - `"db:studio": "drizzle-kit studio"`

(Use exact-version pins later via `pnpm install`; the carets above are starting points.)

- [ ] **Step 3: Verify package.json is valid JSON**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger" && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
Rename package to champ-harbinger and update dependency set

- Remove @supabase/*, agentmail, @ai-sdk/anthropic
- Add drizzle-orm, postgres, @openrouter/ai-sdk-provider, sentry, prom-client
- Add db:* scripts for drizzle-kit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create .env.example with new prefixes

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Write .env.example**

Create `/Users/deep/Apps&Projects/ChampHarbinger/.env.example` with this content:

```env
# ChampHarbinger environment variables
# Copy this file to .env.local for local development

# ─────────────────────────────────────────
# Database (required)
# ─────────────────────────────────────────
DATABASE_URL=postgres://harbinger:harbinger@localhost:5432/champ_harbinger

# ─────────────────────────────────────────
# Auth — Clerk (required)
# ─────────────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup

# ─────────────────────────────────────────
# LLM — OpenRouter (required)
# ─────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-...
HARBINGER_DEFAULT_MODEL=anthropic/claude-sonnet-4.6

# ─────────────────────────────────────────
# App
# ─────────────────────────────────────────
NEXT_PUBLIC_HARBINGER_APP_URL=http://localhost:3000
HARBINGER_NODE_ENV=development

# ─────────────────────────────────────────
# Optional — web automation
# ─────────────────────────────────────────
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=

# ─────────────────────────────────────────
# Optional — job scheduling
# ─────────────────────────────────────────
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# ─────────────────────────────────────────
# Optional — data enrichment
# ─────────────────────────────────────────
EXA_API_KEY=
APIFY_API_TOKEN=
GOOGLE_API_KEY=
GITHUB_TOKEN=

# ─────────────────────────────────────────
# Optional — monitoring
# ─────────────────────────────────────────
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=

# ─────────────────────────────────────────
# Optional — Champions Group internal
# ─────────────────────────────────────────
LAKEB2B_API_KEY=
LAKESTREAM_API_KEY=
CHAMPMAIL_API_KEY=
```

- [ ] **Step 2: Add .env.local to .gitignore (if not already)**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger"
grep -q '^\.env\.local$' .gitignore || echo '.env.local' >> .gitignore
grep -q '^\.env$' .gitignore || echo '.env' >> .gitignore
cat .gitignore | grep '\.env'
```

Expected: at least `.env.local` and `.env` ignored.

- [ ] **Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "$(cat <<'EOF'
Add .env.example with HARBINGER_* prefixed variables

Includes required (DATABASE_URL, Clerk, OpenRouter) and optional
(Browserbase, QStash, Exa, Sentry, ChampMail/Lake B2B) integrations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add docker-compose.yml for local Postgres + app

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write Dockerfile**

Create `/Users/deep/Apps&Projects/ChampHarbinger/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

# ─── deps ─────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ─── builder ──────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ─── runner ───────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./package.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Write .dockerignore**

Create `/Users/deep/Apps&Projects/ChampHarbinger/.dockerignore`:

```
node_modules
.next
.git
.env
.env.local
.env.*.local
docs
README.md
.DS_Store
*.log
coverage
playwright-report
test-results
```

- [ ] **Step 3: Write docker-compose.yml**

Create `/Users/deep/Apps&Projects/ChampHarbinger/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: harbinger-postgres
    environment:
      POSTGRES_USER: harbinger
      POSTGRES_PASSWORD: harbinger
      POSTGRES_DB: champ_harbinger
    ports:
      - "5432:5432"
    volumes:
      - harbinger-pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U harbinger -d champ_harbinger"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: harbinger-app
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    environment:
      DATABASE_URL: postgres://harbinger:harbinger@postgres:5432/champ_harbinger

volumes:
  harbinger-pg-data:
```

- [ ] **Step 4: Update next.config to enable standalone output for Docker**

Read existing `next.config.ts` (or `.js` / `.mjs`) and add `output: 'standalone'` to the config object. Example:

```ts
const nextConfig = {
  output: 'standalone',
  // ...existing config
};
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml next.config.*
git commit -m "$(cat <<'EOF'
Add Docker Compose stack: Postgres 16 + Next.js standalone build

- Multi-stage Dockerfile (deps -> builder -> runner) for smaller images
- docker-compose.yml provisions Postgres 16 (champ_harbinger db) and the app
- next.config: output 'standalone' for Docker runtime
- .dockerignore excludes node_modules, .next, .git, env files, docs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create git worktrees for parallel streams

**Files:**
- Worktrees at: `../champ-harbinger-stream-a/` through `../champ-harbinger-stream-e/`

- [ ] **Step 1: Verify clean state**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger"
git status
git log --oneline | head -10
```

Expected: clean working tree, four commits (spec, Railway update, Signal import, package.json, .env.example, docker-compose).

- [ ] **Step 2: Create five worktrees, one per stream**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger"
git worktree add ../champ-harbinger-stream-a -b stream/a-db
git worktree add ../champ-harbinger-stream-b -b stream/b-branding
git worktree add ../champ-harbinger-stream-c -b stream/c-llm
git worktree add ../champ-harbinger-stream-d -b stream/d-integrations
git worktree add ../champ-harbinger-stream-e -b stream/e-marketing
git worktree list
```

Expected: five worktrees listed alongside the main one.

- [ ] **Step 3: Note the deps-merge convention**

In every parallel stream, if a subagent needs to add a dependency, it appends to a file `DEPS_TO_MERGE.md` in that worktree's root rather than editing `package.json`. Format:

```markdown
# Deps to merge from stream <X>

## dependencies
- some-package@^1.2.3

## devDependencies
- some-dev-tool@^4.5.6
```

This file gets read by Task 17 (post-merge integration) and applied to the canonical `package.json`.

---

# Phase 1 — Parallel Streams

Five tasks dispatched in parallel via `superpowers:dispatching-parallel-agents`. Each subagent operates in its assigned worktree only.

**Lockfile convention (applies to all five streams):** When a stream runs `pnpm install` for verification, `pnpm-lock.yaml` may change. Streams MUST NOT commit lockfile changes — Task 16 (post-merge integration) regenerates the canonical lockfile. Before each stream's commit step, run:

```bash
git checkout pnpm-lock.yaml 2>/dev/null || true
```

(Or, if a stream made no install: this is a no-op.)

**`node_modules` convention:** `node_modules/` is gitignored already. Verify with `git status` before committing.

## Task 6: Stream A — Database layer (Supabase → Drizzle + Postgres)

**Worktree:** `/Users/deep/Apps&Projects/champ-harbinger-stream-a/` (branch `stream/a-db`)

**Owned files / patterns:**
- Create: `db/schema.ts`, `db/index.ts`, `db/migrations/` (will be generated)
- Create: `lib/db/scoped.ts`, `lib/db/admin.ts`, `lib/db/types.ts`
- Create: `drizzle.config.ts`
- Create: `lib/auth.ts` (Clerk auth shim)
- Modify: every file matching `**/*.ts(x)` that imports from `@supabase/supabase-js`, `@supabase/ssr`, or any local `lib/supabase/*` module
- Delete: `lib/supabase/` (entire directory)
- Delete: `supabase/` migrations (they are replaced by `db/migrations`)

**Subagent prompt sketch (use when dispatching):**

> You are implementing the DB layer rewrite for ChampHarbinger. Read the design spec at `docs/superpowers/specs/2026-04-30-champ-harbinger-design.md` (Database Design section). Do NOT edit any file outside the owned scope listed above. Add new dependencies to `DEPS_TO_MERGE.md` instead of touching `package.json`.

**Sub-tasks (the subagent does these in order):**

- [ ] **A1: Audit Supabase usage**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-a
grep -rn "@supabase/supabase-js" --include='*.ts' --include='*.tsx' .
grep -rn "@supabase/ssr" --include='*.ts' --include='*.tsx' .
grep -rn "from ['\"]@/lib/supabase" --include='*.ts' --include='*.tsx' .
ls lib/supabase/ 2>/dev/null
```

Capture every callsite that needs replacing. Note the table names referenced.

- [ ] **A2: Read existing Supabase migrations to learn the schema**

```bash
ls supabase/migrations/
cat supabase/migrations/*.sql
```

Note tables, columns, foreign keys, RLS policies (will be discarded — replaced by app-layer scoping).

- [ ] **A3: Write `drizzle.config.ts`**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

- [ ] **A4: Write `db/schema.ts`** translating Signal's tables to Drizzle

Translate each table from `supabase/migrations/*.sql` (audited in A2) to a Drizzle definition. Conversion rules:
- `auth.users(id)` references → `text` column named `clerk_user_id`, no FK (Clerk owns the identity table)
- Add `clerk_org_id text` where multi-tenancy implies an org boundary (campaigns, signals, sequences, etc.)
- Drop all RLS policies — scoping moves to `lib/db/scoped.ts`
- Keep `created_at`, `updated_at`; add via Drizzle defaults (UTC timestamps)
- Keep UUIDs (`uuid('id').primaryKey().defaultRandom()`)

Template — extend this with one block per Signal table:

```ts
import { pgTable, text, timestamp, uuid, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core';

// Local mirror of Clerk identity. Webhooks (or first-touch upsert) populate this.
export const users = pgTable('users', {
  id: text('id').primaryKey(),                               // Clerk user ID
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Tenant-scoped table pattern. Repeat this shape for every Signal table that
// referenced auth.users(id). Always include clerkUserId; include clerkOrgId
// when the table can be shared inside a Clerk organization.
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkUserId: text('clerk_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    clerkOrgId: text('clerk_org_id'),                        // null = personal scope
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),       // draft | active | paused | archived
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byUser: index('campaigns_clerk_user_id_idx').on(t.clerkUserId),
    byOrg: index('campaigns_clerk_org_id_idx').on(t.clerkOrgId),
  }),
);

// Unscoped reference data (read-only, app-wide). No clerk_user_id.
export const aiModels = pgTable('ai_models', {
  id: text('id').primaryKey(),                               // OpenRouter model id
  displayName: text('display_name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
});
```

Tables to define (final list comes from A1/A2 audit; this is the expected superset based on Signal's domain):
- `users` — Clerk-mirrored identity
- `campaigns` — tenant-owned campaign records
- `signals` — buying-signal events (hiring, funding, news, sentiment)
- `contacts` — enriched person records
- `companies` — enriched company records
- `sequences` — multi-step outreach plans
- `sequence_steps` — individual steps inside a sequence
- `messages` — outbound emails / drafts
- `integrations_state` — per-tenant integration status (Browserbase, QStash, etc.)
- `ai_models` — unscoped reference data (optional, only if Signal had a similar table)

If a Signal table doesn't fit any of these, add it with the same tenant-scoping pattern as `campaigns`.

- [ ] **A5: Write `db/index.ts` (raw Drizzle client)**

Create `db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

// Connection pool. In serverless, prefer per-invocation but still pooled at the platform level.
const queryClient = postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 10 : 5,
  prepare: false, // safer with pgBouncer / Supabase-compatible pools
});

export const db = drizzle(queryClient, { schema });
export { schema };
export type Db = typeof db;
```

- [ ] **A6: Write `lib/auth.ts` (Clerk auth shim)**

Create `lib/auth.ts`:

```ts
import { auth } from '@clerk/nextjs/server';

export async function getCurrentUser() {
  const { userId, orgId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized: no Clerk session');
  }
  return { userId, orgId: orgId ?? null };
}

export async function getCurrentUserOrNull() {
  const { userId, orgId } = await auth();
  return userId ? { userId, orgId: orgId ?? null } : null;
}
```

- [ ] **A7: Write `lib/db/scoped.ts`**

Create `lib/db/scoped.ts`. The helper returns a Drizzle instance whose select/insert/update/delete are bound to the current Clerk identity. Implementation pattern: a thin wrapper that exposes scoped query builders for each table that has tenant columns.

```ts
import { eq, and, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getCurrentUser } from '@/lib/auth';

type ScopedTable = keyof typeof schema;

/**
 * Returns a Drizzle DB whose read/write helpers are auto-scoped to the
 * current Clerk userId (and orgId, when present).
 *
 * Usage:
 *   const sdb = await getScopedDb();
 *   const myCampaigns = await sdb.select().from(schema.campaigns); // already scoped
 */
export async function getScopedDb() {
  const { userId, orgId } = await getCurrentUser();

  return {
    raw: db, // escape hatch for join-heavy queries; caller responsible for scoping
    userId,
    orgId,

    /**
     * Returns a `where` clause that scopes by user, falling back to org if
     * the table has clerk_org_id, or just user_id otherwise.
     */
    scope(table: { clerkUserId?: any; clerkOrgId?: any }): SQL | undefined {
      if (orgId && 'clerkOrgId' in table && table.clerkOrgId) {
        return eq(table.clerkOrgId, orgId);
      }
      if ('clerkUserId' in table && table.clerkUserId) {
        return eq(table.clerkUserId, userId);
      }
      return undefined;
    },

    /**
     * Combines an external `where` predicate with the tenant scope.
     */
    scoped(table: any, where?: SQL): SQL | undefined {
      const s = this.scope(table);
      if (!where) return s;
      if (!s) return where;
      return and(s, where);
    },
  };
}

export type ScopedDb = Awaited<ReturnType<typeof getScopedDb>>;
```

- [ ] **A8: Write `lib/db/admin.ts` (system-task escape hatch)**

Create `lib/db/admin.ts`:

```ts
import { db } from '@/db';

/**
 * Unscoped DB instance for system tasks: migrations, cron jobs,
 * webhooks where there is no Clerk session.
 *
 * NEVER import this from a route handler that responds to user requests.
 */
export const adminDb = db;
```

- [ ] **A9: Write tests for the scoped DB helper**

Create `lib/db/scoped.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { _marker: 'raw-db' },
  schema: {
    campaigns: { clerkUserId: { _col: 'clerk_user_id' }, clerkOrgId: { _col: 'clerk_org_id' } },
  },
}));

import { getCurrentUser } from '@/lib/auth';
import { getScopedDb } from './scoped';
import { schema } from '@/db';

describe('getScopedDb', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exposes userId and orgId from the current session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'user_1', orgId: 'org_1' });
    const sdb = await getScopedDb();
    expect(sdb.userId).toBe('user_1');
    expect(sdb.orgId).toBe('org_1');
  });

  it('scope() prefers orgId when both are present and column exists', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'user_1', orgId: 'org_1' });
    const sdb = await getScopedDb();
    const s = sdb.scope(schema.campaigns);
    expect(String(s)).toContain('clerk_org_id'); // crude but adequate
  });

  it('scope() falls back to userId when no orgId', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'user_1', orgId: null });
    const sdb = await getScopedDb();
    const s = sdb.scope(schema.campaigns);
    expect(String(s)).toContain('clerk_user_id');
  });

  it('throws if no Clerk session', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Unauthorized'));
    await expect(getScopedDb()).rejects.toThrow('Unauthorized');
  });
});
```

Run: `pnpm test lib/db/scoped.test.ts` — expected: PASS.

- [ ] **A10: Replace each Supabase callsite with the scoped DB**

For every callsite identified in A1, replace the pattern:

```ts
// before
import { createClient } from '@/lib/supabase/server';
const sb = createClient();
const { data } = await sb.from('campaigns').select('*');
```

With:

```ts
// after
import { getScopedDb } from '@/lib/db/scoped';
import { schema } from '@/db';
const sdb = await getScopedDb();
const data = await sdb.raw.select().from(schema.campaigns).where(sdb.scope(schema.campaigns));
```

For inserts, scope by setting `clerk_user_id` (and `clerk_org_id` when applicable) explicitly:

```ts
const sdb = await getScopedDb();
await sdb.raw.insert(schema.campaigns).values({
  ...input,
  clerkUserId: sdb.userId,
  clerkOrgId: sdb.orgId,
});
```

- [ ] **A11: Delete `lib/supabase/` and `supabase/migrations/`**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-a
rm -rf lib/supabase
rm -rf supabase/migrations
# Keep supabase/config.toml or other non-migration files only if Signal had useful ones; otherwise rm -rf supabase
```

- [ ] **A12: Generate the initial Drizzle migration**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-a
# DEPS_TO_MERGE doesn't help us here — we need drizzle-kit installed locally to run.
# Install just for this stream's verification step (don't commit lockfile changes):
pnpm install
pnpm db:generate
ls db/migrations/
```

Expected: a `0000_<name>.sql` file plus `meta/` directory.

- [ ] **A13: Boot Postgres locally and apply the migration**

```bash
docker compose -f /Users/deep/Apps\&Projects/ChampHarbinger/docker-compose.yml up -d postgres
# Wait a few seconds for healthcheck
DATABASE_URL=postgres://harbinger:harbinger@localhost:5432/champ_harbinger pnpm db:migrate
```

Expected: migration applied without errors.

- [ ] **A14: Add deps note**

Append to `DEPS_TO_MERGE.md` in this worktree (only entries actually used here, since they were already added in Task 2 — verify):

```markdown
# Deps to merge from stream A
(All deps already declared in Task 2's package.json. No additions.)
```

- [ ] **A15: Commit Stream A**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-a
git checkout pnpm-lock.yaml 2>/dev/null || true
git add -A
git commit -m "$(cat <<'EOF'
Stream A: replace Supabase with Drizzle + postgres.js

- Define schema in db/schema.ts (translated from Supabase migrations)
- Drop RLS in favor of app-layer scoping via lib/db/scoped.ts
- lib/auth.ts wraps Clerk's auth() to expose { userId, orgId }
- Replace every @supabase/* callsite with scoped Drizzle queries
- Delete lib/supabase/ and supabase/migrations/
- Generate initial Drizzle migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Stream B — Branding sweep (Signal → ChampHarbinger)

**Worktree:** `/Users/deep/Apps&Projects/champ-harbinger-stream-b/` (branch `stream/b-branding`)

**Owned files / patterns:**
- Modify: `tailwind.config.*`, `app/globals.css`, `components.json`
- Modify: `app/layout.tsx`, `app/(marketing)/layout.tsx` and any layout files (for typography + favicon refs only — text content stays for Stream E)
- Modify: every UI string referencing "Signal" the product (excluding marketing copy → that's Stream E)
- Modify: every code comment referencing "Signal" the product
- Modify: README.md, LICENSE (header)
- Replace: `public/favicon.ico`, `public/apple-touch-icon.png`, `public/og-image.png`, any logo SVGs in `public/` or `components/logo*`
- Modify: cookie names, localStorage keys (`signal_*` → `harbinger_*`)
- Modify: error message strings, email template subjects/bodies (Subject/sender only — not body content yet)

**Excluded (other streams own these):**
- `db/`, `lib/db/`, `lib/auth.ts` — Stream A
- `lib/ai/`, anything OpenRouter-related — Stream C
- `lib/email/`, `lib/monitoring/`, `instrumentation.ts`, `app/api/metrics` — Stream D
- `app/(marketing)/page.tsx` (and other landing components) — Stream E

**Subagent prompt sketch:**

> You are doing the cosmetic + textual rebrand of ChampHarbinger. Read the design spec at `docs/superpowers/specs/2026-04-30-champ-harbinger-design.md` (Branding System section). Apply Champions Group brand guidelines: orange #F26722 + white + Ink, Inter typography. Do NOT edit any file outside the owned scope. Marketing landing copy is Stream E's job — only do non-landing UI strings. Add new dependencies to `DEPS_TO_MERGE.md`.

**Sub-tasks:**

- [ ] **B1: Audit Signal references**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-b
grep -rn -i 'signal' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.json' --include='*.css' . | grep -v node_modules | grep -v '\.git' > /tmp/signal-refs.txt
wc -l /tmp/signal-refs.txt
```

Review `/tmp/signal-refs.txt`. Categorize each match:
- "Signal" the product name → REPLACE with "ChampHarbinger"
- "signal" as a generic word in product copy ("buying signals") → KEEP (it's still relevant)
- `AbortSignal`, type names, etc. → KEEP
- Marketing landing copy → SKIP (Stream E)

- [ ] **B2: Apply Champions Group color tokens to Tailwind**

Find existing `tailwind.config.ts` (or `.js`). Replace the `theme.extend.colors` block (or merge into it):

```ts
extend: {
  colors: {
    champions: {
      orange: '#F26722',
      'deep-orange': '#D94F0A',
      'bright-orange': '#FF8544',
      'soft-peach': '#FFF4EC',
      'warm-tint': '#FFE8D6',
      ink: '#1A1A1A',
      'ink-soft': '#2E2E2E',
      'warm-gray': '#6B6B6B',
      border: '#E5E7EB',
      'off-white': '#FAFAFA',
      'light-gray': '#F5F5F5',
    },
  },
  backgroundImage: {
    'champions-gradient': 'linear-gradient(135deg, #F26722 0%, #D94F0A 100%)',
    'warm-sunset': 'linear-gradient(135deg, #FF8544 0%, #F26722 100%)',
    'peach-wash': 'linear-gradient(180deg, #FFF4EC 0%, #FFFFFF 100%)',
    'orange-fade': 'linear-gradient(180deg, #F26722 0%, #FFE8D6 100%)',
  },
  fontFamily: {
    sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Arial', 'sans-serif'],
  },
},
```

- [ ] **B3: Add Inter font via next/font in `app/layout.tsx`**

In `app/layout.tsx` (root), at the top:

```tsx
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
```

Apply to the `<html>` or `<body>` element:

```tsx
<html lang="en" className={inter.variable}>
  <body className="font-sans bg-white text-champions-ink">{children}</body>
</html>
```

- [ ] **B4: Update `app/globals.css` with brand CSS custom properties**

Append (or replace existing brand vars):

```css
:root {
  --cg-orange: #F26722;
  --cg-deep-orange: #D94F0A;
  --cg-bright-orange: #FF8544;
  --cg-soft-peach: #FFF4EC;
  --cg-warm-tint: #FFE8D6;
  --cg-ink: #1A1A1A;
  --cg-ink-soft: #2E2E2E;
  --cg-white: #FFFFFF;
  --cg-warm-gray: #6B6B6B;
  --cg-border: #E5E7EB;
  --cg-light-gray: #F5F5F5;
  --cg-off-white: #FAFAFA;
}
```

Also remap shadcn's CSS vars (these usually live in `:root` and `.dark`). Replace the `--primary` and `--primary-foreground` blocks:

```css
:root {
  --primary: 21 89% 57%;          /* HSL of #F26722 */
  --primary-foreground: 0 0% 100%; /* White */
  --ring: 21 89% 57%;
}
```

- [ ] **B5: Update `components.json` (shadcn config) if it pins colors**

Open `components.json`. If it has a `tailwind.cssVariables` setting, leave as `true`. If it has a base color preset, change it to a custom one or keep neutral and let `globals.css` handle it.

- [ ] **B6: Replace Signal product references in non-landing UI**

For each file in `/tmp/signal-refs.txt` that is NOT in `app/(marketing)/` and matches "Signal" the product:

- Replace "Signal" → "ChampHarbinger" (case-sensitive, capitalized form)
- Replace "signal" → "harbinger" (case-sensitive, lowercase, ONLY when it's clearly the product brand — variable names, env keys, identifiers)
- Replace cookie/localStorage keys: `signal_*` → `harbinger_*`
- Replace email subject/sender names mentioning Signal

Use `sed -i '' 's/old/new/g' <file>` for safe in-place edits, or your editor's find/replace with explicit confirm.

Common patterns to fix:
- `<title>Signal</title>` → `<title>ChampHarbinger</title>`
- `metadata: { title: 'Signal' }` → `metadata: { title: 'ChampHarbinger' }`
- `cookieName: 'signal_session'` → `cookieName: 'harbinger_session'`
- `// Signal does X` (comments) → `// ChampHarbinger does X`

- [ ] **B7: Replace logo and favicon assets**

Generate a placeholder SVG wordmark for ChampHarbinger:

Create/replace `public/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 64" width="320" height="64">
  <rect width="320" height="64" fill="#FFFFFF"/>
  <circle cx="32" cy="32" r="14" fill="#F26722"/>
  <path d="M 32 18 L 32 46 M 22 28 L 32 18 L 42 28" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="60" y="42" font-family="Inter, -apple-system, sans-serif" font-size="28" font-weight="700" fill="#1A1A1A">ChampHarbinger</text>
</svg>
```

Generate a simple favicon placeholder (or copy logo.svg as `public/favicon.svg`). For PNG fallbacks, the engineer may use any 32×32 / 180×180 generator; for v1 a single SVG favicon is acceptable:

- Replace `public/favicon.ico` with a 32×32 generated from the SVG (or delete it and add `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />` in layout)
- Replace `public/apple-touch-icon.png` with a placeholder
- Replace `public/og-image.png` with a placeholder (1200×630 with the wordmark on white)

For og-image, a simple HTML-to-image one-shot will do later; in v1 placing a static placeholder is fine.

Update `app/layout.tsx` icon refs:

```tsx
export const metadata = {
  title: 'ChampHarbinger',
  description: 'A Champions Group product. Detect buying signals before they become deals.',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
};
```

- [ ] **B8: Rewrite README.md**

Replace `README.md` with a Champions Group-voiced rewrite:

```markdown
# ChampHarbinger

A Champions Group product. ChampHarbinger detects buying signals on the web before they become deals — monitoring hiring, funding, news, and review-sentiment shifts, then enriching contacts and drafting personalized outreach in a chat-first workspace.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Drizzle ORM · Postgres 16 · Clerk · OpenRouter (Vercel AI SDK) · Sentry · Prometheus.

## Local development

Requirements: Docker, pnpm, a Clerk project, an OpenRouter API key.

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

## Deployment

Railway: see `docs/superpowers/plans/2026-04-30-champ-harbinger-implementation.md` for the staging setup. Any standard Postgres host works; the only thing that changes is `DATABASE_URL`.

## Champions Group

ChampHarbinger is part of the Champ suite — sitting alongside ChampOracle, ChampMail, ChampIQ, ChampQuest, ChampTrack, ChampUTM, ChampVideo, and ChampVox. *Empowering Innovation. Building Resilience.*

---

License: AGPL-3.0-only. © Champions Group.
```

- [ ] **B9: Update LICENSE header**

If `LICENSE` exists with attribution to jay-sahnan / Signal, update the copyright line:

```
Copyright (C) 2026 Champions Group
```

Keep the AGPL-3.0 license body intact.

- [ ] **B10: Verify the rebrand**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-b
grep -rn 'Signal' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.json' . | grep -v node_modules | grep -v '\.git' | grep -v 'app/(marketing)'
```

Expected: zero matches OR only matches that are clearly NOT the product name (e.g., `AbortSignal`, "buying signals" copy, etc.). Review every remaining match by hand.

- [ ] **B11: Append `DEPS_TO_MERGE.md`**

```markdown
# Deps to merge from stream B
(No new runtime deps. Inter loaded via next/font/google — no install needed.)
```

- [ ] **B12: Commit Stream B**

```bash
git checkout pnpm-lock.yaml 2>/dev/null || true
git add -A
git commit -m "$(cat <<'EOF'
Stream B: Champions Group brand sweep (Signal -> ChampHarbinger)

- Tailwind config + globals.css: champions.* color tokens, Inter font
- shadcn theme remapped (--primary -> Champions orange)
- Replace product-name references in non-landing UI, comments, env keys,
  cookie/localStorage names
- Replace logo, favicon, OG image placeholders with ChampHarbinger wordmark
- Rewrite README.md in Champions Group voice
- Update LICENSE header to Champions Group copyright

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Stream C — LLM provider (Anthropic direct → OpenRouter)

**Worktree:** `/Users/deep/Apps&Projects/champ-harbinger-stream-c/` (branch `stream/c-llm`)

**Owned files / patterns:**
- Create: `lib/ai/provider.ts`, `lib/ai/models.ts`, `lib/ai/env.ts`
- Modify: every callsite using `@ai-sdk/anthropic` or hardcoded Anthropic model IDs
- Delete: any `lib/anthropic.ts` or similar single-vendor wrapper

**Subagent prompt sketch:**

> You are swapping ChampHarbinger's LLM access from Anthropic-direct to OpenRouter via the Vercel AI SDK. Read the spec section "LLM Provider". OpenRouter exposes 100+ models behind one provider; default model is configurable via `HARBINGER_DEFAULT_MODEL` env var. Do not touch DB, branding, integrations, or marketing files.

**Sub-tasks:**

- [ ] **C1: Audit Anthropic usage**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-c
grep -rn '@ai-sdk/anthropic' --include='*.ts' --include='*.tsx' . | grep -v node_modules
grep -rn 'anthropic\.messages\.create\|createAnthropic\|anthropicClient' --include='*.ts' --include='*.tsx' . | grep -v node_modules
ls lib/ 2>/dev/null
```

- [ ] **C2: Write `lib/ai/env.ts` (env validation)**

```ts
import { z } from 'zod';

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
  HARBINGER_DEFAULT_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
});

export const aiEnv = schema.parse({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  HARBINGER_DEFAULT_MODEL: process.env.HARBINGER_DEFAULT_MODEL,
});
```

- [ ] **C3: Write `lib/ai/models.ts` (named model presets)**

```ts
/**
 * Named model presets to avoid scattering OpenRouter model IDs throughout
 * the codebase. Override per-call only when a feature needs something
 * specific (cheap classifier vs. heavy drafting model).
 */
export const Models = {
  default: () => process.env.HARBINGER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4.6',
  drafting: 'anthropic/claude-sonnet-4.6',
  classification: 'openai/gpt-4o-mini',
  cheap: 'openai/gpt-4o-mini',
  reasoning: 'openai/o1-mini',
} as const;

export type ModelKey = keyof typeof Models;
```

- [ ] **C4: Write `lib/ai/provider.ts` (OpenRouter wrapper)**

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { aiEnv } from './env';

const openrouter = createOpenRouter({
  apiKey: aiEnv.OPENROUTER_API_KEY,
});

/**
 * Returns a Vercel AI SDK LanguageModel. Pass an OpenRouter model ID
 * (e.g. "anthropic/claude-sonnet-4.6", "openai/gpt-4o-mini") or use the
 * Models map.
 */
export function getModel(modelId?: string) {
  return openrouter(modelId ?? aiEnv.HARBINGER_DEFAULT_MODEL);
}

export { openrouter };
```

- [ ] **C5: Write tests**

Create `lib/ai/provider.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('getModel', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.HARBINGER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
  });

  it('returns a LanguageModel for the default when no id given', async () => {
    const { getModel } = await import('./provider');
    const m = getModel();
    expect(m).toBeDefined();
    // Vercel AI SDK models expose a modelId or specificationVersion;
    // we just assert it's truthy here, full integration is verified later.
  });

  it('returns a LanguageModel for an explicit id', async () => {
    const { getModel } = await import('./provider');
    const m = getModel('openai/gpt-4o-mini');
    expect(m).toBeDefined();
  });

  it('throws if OPENROUTER_API_KEY missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(import('./env')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
```

Run: `pnpm test lib/ai/provider.test.ts`. Expected: PASS.

- [ ] **C6: Replace each Anthropic callsite**

For each file using `@ai-sdk/anthropic`:

```ts
// before
import { anthropic } from '@ai-sdk/anthropic';
const { text } = await generateText({
  model: anthropic('claude-sonnet-4-5-20250929'),
  prompt,
});
```

```ts
// after
import { getModel } from '@/lib/ai/provider';
const { text } = await generateText({
  model: getModel(), // or getModel(Models.classification) for cheaper calls
  prompt,
});
```

For `streamText`, `generateObject`, etc.: same swap — only the `model:` argument changes.

- [ ] **C7: Delete the old single-vendor wrapper if present**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-c
rm -f lib/anthropic.ts lib/ai/anthropic.ts
```

- [ ] **C8: Append DEPS_TO_MERGE.md**

```markdown
# Deps to merge from stream C
(@openrouter/ai-sdk-provider already added in Task 2. zod confirmed present.
@ai-sdk/anthropic removal confirmed in Task 2. No additions.)
```

- [ ] **C9: Commit Stream C**

```bash
git checkout pnpm-lock.yaml 2>/dev/null || true
git add -A
git commit -m "$(cat <<'EOF'
Stream C: swap LLM provider Anthropic-direct -> OpenRouter

- lib/ai/provider.ts wraps @openrouter/ai-sdk-provider
- lib/ai/models.ts: named presets (default/drafting/classification/...)
- lib/ai/env.ts: zod-validated env (OPENROUTER_API_KEY, HARBINGER_DEFAULT_MODEL)
- Replace every @ai-sdk/anthropic callsite with getModel() from new provider
- Delete legacy single-vendor wrappers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Stream D — Integrations + monitoring

**Worktree:** `/Users/deep/Apps&Projects/champ-harbinger-stream-d/` (branch `stream/d-integrations`)

**Owned files / patterns:**
- Create: `lib/email/provider.ts`, `lib/email/stub.ts`, `lib/email/types.ts`
- Create: `lib/monitoring/sentry.ts`, `lib/monitoring/metrics.ts`
- Create: `instrumentation.ts` (Next.js root)
- Create: `app/api/metrics/route.ts`
- Create: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Modify: every callsite using AgentMail
- Delete: any `lib/email/agentmail.ts` or `lib/agentmail.ts`

**Subagent prompt sketch:**

> You are wiring ChampHarbinger's monitoring (Sentry + Prometheus) and replacing AgentMail with a stub email interface. Read the spec sections "Optional Integrations" and "Monitoring". The email stub interface should let sequence-sending paths compile and run cleanly even when no provider is configured (graceful degradation). Do not touch DB, branding, LLM, or marketing files.

**Sub-tasks:**

- [ ] **D1: Audit AgentMail usage**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-d
grep -rn 'agentmail\|AgentMail' --include='*.ts' --include='*.tsx' . | grep -v node_modules
ls lib/email/ 2>/dev/null
```

- [ ] **D2: Write `lib/email/types.ts` (provider interface)**

```ts
export interface SendEmailInput {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}

export interface SendEmailResult {
  id: string;
  status: 'sent' | 'queued' | 'failed';
  providerId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
```

- [ ] **D3: Write `lib/email/stub.ts` (no-op default)**

```ts
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types';

export class StubEmailProvider implements EmailProvider {
  readonly name = 'stub';
  readonly enabled = false;

  async send(_input: SendEmailInput): Promise<SendEmailResult> {
    return {
      id: `stub_${Date.now()}`,
      status: 'failed',
      error: 'Email sending is disabled. Configure ChampMail or another provider to enable.',
    };
  }
}
```

- [ ] **D4: Write `lib/email/provider.ts` (factory)**

```ts
import type { EmailProvider } from './types';
import { StubEmailProvider } from './stub';

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  // Future: branch on env vars to instantiate ChampMail, Resend, Postmark, etc.
  cached = new StubEmailProvider();
  return cached;
}
```

- [ ] **D5: Test the email stub**

Create `lib/email/stub.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StubEmailProvider } from './stub';

describe('StubEmailProvider', () => {
  it('reports disabled', () => {
    const p = new StubEmailProvider();
    expect(p.enabled).toBe(false);
    expect(p.name).toBe('stub');
  });

  it('returns failed status with explanatory error', async () => {
    const p = new StubEmailProvider();
    const res = await p.send({ to: 'a@b.com', from: 'c@d.com', subject: 's', text: 't' });
    expect(res.status).toBe('failed');
    expect(res.error).toContain('disabled');
  });
});
```

Run: `pnpm test lib/email/stub.test.ts`. Expected: PASS.

- [ ] **D6: Replace each AgentMail callsite with `getEmailProvider()`**

```ts
// before
import { AgentMail } from 'agentmail';
const am = new AgentMail({ apiKey: process.env.AGENTMAIL_API_KEY! });
await am.send({ to, from, subject, body });
```

```ts
// after
import { getEmailProvider } from '@/lib/email/provider';
const provider = getEmailProvider();
const result = await provider.send({ to, from, subject, text: body });
if (result.status === 'failed') {
  // surface a "disabled" message in the UI / log appropriately
}
```

- [ ] **D7: Delete the old AgentMail wrapper**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-d
rm -f lib/email/agentmail.ts lib/agentmail.ts
```

- [ ] **D8: Wire Sentry — config files**

Create `sentry.client.config.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NEXT_PUBLIC_HARBINGER_ENV || 'development',
  });
}
```

Create `sentry.server.config.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.HARBINGER_NODE_ENV || 'development',
  });
}
```

Create `sentry.edge.config.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.HARBINGER_NODE_ENV || 'development',
  });
}
```

Create `instrumentation.ts` (Next.js root):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { onRequestError } from '@sentry/nextjs';
```

- [ ] **D9: Wire Prometheus metrics**

Create `lib/monitoring/metrics.ts`:

```ts
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

declare global {
  // eslint-disable-next-line no-var
  var __harbinger_registry: Registry | undefined;
}

function getRegistry(): Registry {
  if (!global.__harbinger_registry) {
    const r = new Registry();
    collectDefaultMetrics({ register: r, prefix: 'harbinger_' });
    global.__harbinger_registry = r;
  }
  return global.__harbinger_registry;
}

const r = getRegistry();

export const httpRequestsTotal = new Counter({
  name: 'harbinger_http_requests_total',
  help: 'Total HTTP requests handled',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [r],
});

export const httpRequestDuration = new Histogram({
  name: 'harbinger_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [r],
});

export const aiCallsTotal = new Counter({
  name: 'harbinger_ai_calls_total',
  help: 'Total AI provider calls',
  labelNames: ['model', 'status'] as const,
  registers: [r],
});

export const aiCallDuration = new Histogram({
  name: 'harbinger_ai_call_duration_seconds',
  help: 'AI call duration in seconds',
  labelNames: ['model'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [r],
});

export function getRegistryForExport() {
  return r;
}
```

Create `app/api/metrics/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRegistryForExport } from '@/lib/monitoring/metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const registry = getRegistryForExport();
  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
```

- [ ] **D10: Test the metrics endpoint locally**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-d
pnpm install
pnpm dev &  # background
sleep 8
curl -s http://localhost:3000/api/metrics | head -30
kill %1
```

Expected: Prometheus-format text output starting with `# HELP harbinger_*` lines.

- [ ] **D11: Append DEPS_TO_MERGE.md**

```markdown
# Deps to merge from stream D
(@sentry/nextjs and prom-client already added in Task 2. agentmail removal
confirmed in Task 2. No additions.)
```

- [ ] **D12: Commit Stream D**

```bash
git checkout pnpm-lock.yaml 2>/dev/null || true
git add -A
git commit -m "$(cat <<'EOF'
Stream D: monitoring (Sentry + Prometheus) and email stub

- lib/email/{types,stub,provider}.ts: swappable EmailProvider interface
- StubEmailProvider returns "disabled" responses (graceful degradation)
- Replace AgentMail callsites with getEmailProvider()
- sentry.{client,server,edge}.config.ts + instrumentation.ts
- lib/monitoring/metrics.ts: prom-client Registry + HTTP/AI counters
- app/api/metrics/route.ts: Prometheus-format /metrics endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Stream E — Marketing/landing polish

**Worktree:** `/Users/deep/Apps&Projects/champ-harbinger-stream-e/` (branch `stream/e-marketing`)

**Owned files / patterns:**
- Modify: `app/(marketing)/page.tsx` and any landing route components
- Modify: `app/(marketing)/layout.tsx` if it exists (only the parts inside this route group)
- Create: `components/marketing/hero.tsx`, `components/marketing/feature-grid.tsx`, `components/marketing/cta.tsx` (decompose the landing into focused pieces)

**Subagent prompt sketch:**

> You are polishing ChampHarbinger's marketing/landing surface. Read the design spec sections "Branding System" and the Champions Group brand guidelines (orange #F26722 + white + Ink, Inter typography, voice: authoritative, warm, visionary, empowering, precise). Do NOT touch DB, branding sweep on non-landing files, LLM provider, integrations/monitoring, or anything outside `app/(marketing)/` and `components/marketing/`.

**Sub-tasks:**

- [ ] **E1: Read existing marketing/landing**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-e
ls app/\(marketing\)/ 2>/dev/null
find app/ -name 'page.tsx' -not -path '*/node_modules/*' | head
cat app/page.tsx 2>/dev/null | head -100
cat app/\(marketing\)/page.tsx 2>/dev/null | head -100
```

If Signal puts the landing at `app/page.tsx` (no marketing route group), that's fine — treat that file as your scope.

- [ ] **E2: Create `components/marketing/hero.tsx`**

```tsx
import Link from 'next/link';

export function Hero() {
  return (
    <section className="bg-peach-wash">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-champions-orange">
          A Champions Group product
        </p>
        <h1 className="mt-4 text-5xl font-bold tracking-tight text-champions-ink sm:text-6xl">
          Detect buying signals before they become deals.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-champions-ink-soft">
          ChampHarbinger watches the web for hiring shifts, funding rounds,
          product launches, and sentiment changes — then enriches contacts
          and drafts personalized outreach in a single chat-first workspace.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md bg-champions-orange px-6 py-3 text-base font-semibold text-white transition hover:bg-champions-deep-orange"
          >
            Get started
          </Link>
          <Link
            href="#features"
            className="inline-flex items-center justify-center rounded-md border border-champions-orange bg-white px-6 py-3 text-base font-semibold text-champions-orange transition hover:bg-champions-soft-peach"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **E3: Create `components/marketing/feature-grid.tsx`**

```tsx
const features = [
  {
    title: 'Signals engine',
    body: 'Continuous web monitoring for hiring changes, funding announcements, product launches, and review-sentiment shifts. Filter to the moves that matter.',
  },
  {
    title: 'Contact enrichment',
    body: 'Pull company and contact data from Lake B2B, Exa, and the open web. Verified, accurate, and ready for outreach.',
  },
  {
    title: 'Outreach drafting',
    body: 'AI-drafted personalized messages grounded in the signal that surfaced the prospect. Edit, approve, and queue in one place.',
  },
  {
    title: 'Sequences',
    body: 'Multi-step email sequences with reply detection. Automated where it helps, manual where it matters.',
  },
  {
    title: 'Browser automation',
    body: 'Browserbase + Stagehand handle the long tail of web data. When the public API is missing, ChampHarbinger fetches it anyway.',
  },
  {
    title: 'Own your data',
    body: 'Bring your own Postgres. Bring your own LLM (any model on OpenRouter). No vendor lock, no shared multi-tenant database.',
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-bold tracking-tight text-champions-ink sm:text-4xl">
          Built for sales teams that move first.
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-champions-border bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-champions-ink">
                <span className="mr-2 text-champions-orange">▸</span>
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-champions-ink-soft">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **E4: Create `components/marketing/cta.tsx`**

```tsx
import Link from 'next/link';

export function CTA() {
  return (
    <section className="bg-champions-gradient">
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          The signals are already there. Find them first.
        </h2>
        <p className="mt-4 text-lg text-white/90">
          ChampHarbinger surfaces buying intent before your competitors notice.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex items-center justify-center rounded-md bg-white px-6 py-3 text-base font-semibold text-champions-orange transition hover:bg-champions-soft-peach"
        >
          Start now
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **E5: Wire the components into the landing page**

Edit the landing route file (`app/(marketing)/page.tsx` or `app/page.tsx`):

```tsx
import { Hero } from '@/components/marketing/hero';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { CTA } from '@/components/marketing/cta';

export default function HomePage() {
  return (
    <main>
      <Hero />
      <FeatureGrid />
      <CTA />
    </main>
  );
}
```

If the existing file has imports/wrapping (header, footer) you want to preserve, splice in the three components rather than replacing wholesale.

- [ ] **E6: Visual smoke test**

```bash
cd /Users/deep/Apps\&Projects/champ-harbinger-stream-e
pnpm install
pnpm dev &
sleep 8
curl -s http://localhost:3000/ | head -50
kill %1
```

Expected: HTML response containing "Detect buying signals before they become deals." and "ChampHarbinger".

- [ ] **E7: Append DEPS_TO_MERGE.md**

```markdown
# Deps to merge from stream E
(No new deps.)
```

- [ ] **E8: Commit Stream E**

```bash
git checkout pnpm-lock.yaml 2>/dev/null || true
git add -A
git commit -m "$(cat <<'EOF'
Stream E: marketing/landing rewrite in Champions Group voice

- components/marketing/{hero,feature-grid,cta}.tsx (decomposed surface)
- Landing page wires Hero, FeatureGrid, and gradient CTA
- Voice: authoritative, warm, visionary, empowering, precise
- All copy uses Champions Group palette tokens (no hardcoded colors)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 2 — Integration

Sequential. One agent. Resolves the parallel work into `main`.

## Task 11: Merge Stream A → main

**Files:**
- Modify: many (whatever Stream A touched)

- [ ] **Step 1: Switch back to main worktree**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
git status
```

- [ ] **Step 2: Merge stream/a-db**

```bash
git merge --no-ff stream/a-db -m "$(cat <<'EOF'
Merge Stream A: DB layer (Supabase -> Drizzle + Postgres)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If conflicts: resolve, choose Stream A's version for any DB-related file (this is its owned scope), then commit.

## Task 12: Merge Stream B → main

- [ ] **Step 1: Merge stream/b-branding**

```bash
git merge --no-ff stream/b-branding -m "$(cat <<'EOF'
Merge Stream B: Champions Group brand sweep

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Conflict expectation: minor. If a non-landing UI string was touched by both A and B (unlikely given disjoint scope), prefer B for branding text and A for DB code.

## Task 13: Merge Stream C → main

```bash
git merge --no-ff stream/c-llm -m "Merge Stream C: OpenRouter LLM provider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 14: Merge Stream D → main

```bash
git merge --no-ff stream/d-integrations -m "Merge Stream D: Sentry + Prometheus + email stub

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 15: Merge Stream E → main

```bash
git merge --no-ff stream/e-marketing -m "Merge Stream E: marketing landing in Champions Group voice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task 16: Apply DEPS_TO_MERGE notes and reinstall

- [ ] **Step 1: Inspect deps notes from each stream**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
find . -name 'DEPS_TO_MERGE.md' -not -path '*/node_modules/*'
cat $(find . -name 'DEPS_TO_MERGE.md' -not -path '*/node_modules/*')
```

- [ ] **Step 2: Apply any actual additions to package.json**

For each new dep in any DEPS_TO_MERGE.md, add to `package.json` and remove the per-stream notes:

```bash
# Example, if any stream had real additions:
# pnpm add <package>

# Then clean up:
git rm $(find . -name 'DEPS_TO_MERGE.md' -not -path '*/node_modules/*')
```

- [ ] **Step 3: Install lockfile-aware**

```bash
pnpm install
```

Expected: lockfile updated, no errors.

- [ ] **Step 4: Commit lockfile**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Apply DEPS_TO_MERGE notes and refresh lockfile

Post-merge consolidation step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 17: Run lint, typecheck, tests, and build

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: clean. Fix any issues introduced by the merges.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck || pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Tests**

```bash
pnpm test --run
```

Expected: all pass. Existing Signal tests may need rebrand-related updates; remove or update tests that asserted on Signal-specific copy.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: successful Next.js production build, including the standalone output.

- [ ] **Step 5: Commit any cleanups**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Post-merge cleanup: lint/typecheck/test/build green

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 18: Tear down worktrees

- [ ] **Step 1: Remove worktrees and branches**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
git worktree remove ../champ-harbinger-stream-a
git worktree remove ../champ-harbinger-stream-b
git worktree remove ../champ-harbinger-stream-c
git worktree remove ../champ-harbinger-stream-d
git worktree remove ../champ-harbinger-stream-e
git branch -d stream/a-db stream/b-branding stream/c-llm stream/d-integrations stream/e-marketing
git worktree list
git branch
```

Expected: only `main` remains.

---

# Phase 3 — Local Verification

## Task 19: Verify Phase 1 verification gates

- [ ] **Step 1: Boot the full stack**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
cp .env.example .env.local
# Edit .env.local: fill in real CLERK_*, OPENROUTER_API_KEY (use a test/cheap model preset)
docker compose up --build -d
docker compose logs -f app &
LOGS_PID=$!
sleep 30
kill $LOGS_PID 2>/dev/null
```

- [ ] **Step 2: Verify Postgres + migration**

```bash
docker exec harbinger-postgres psql -U harbinger -d champ_harbinger -c "\dt"
```

Expected: list of tables matching `db/schema.ts`.

- [ ] **Step 3: Verify HTTP responsiveness**

```bash
curl -sI http://localhost:3000/
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 4: Verify rebrand markers in served HTML**

```bash
curl -s http://localhost:3000/ | grep -i 'ChampHarbinger' | head -3
curl -s http://localhost:3000/ | grep -ci '\bsignal\b' || true
```

Expected: ChampHarbinger appears multiple times. "Signal" as the product brand should not appear; instances of "buying signals" or `AbortSignal` are fine.

- [ ] **Step 5: Verify Clerk login flow**

Manual: open http://localhost:3000/login in a browser, sign in with a Clerk test user, confirm redirect to dashboard works.

- [ ] **Step 6: Verify a write through scoped DB**

Manual: through the UI (or a server action), create a campaign or whatever the simplest tenant-owned record is. Then:

```bash
docker exec harbinger-postgres psql -U harbinger -d champ_harbinger -c "SELECT id, clerk_user_id FROM campaigns LIMIT 3;"
```

Expected: row visible with the current user's Clerk ID in `clerk_user_id`.

- [ ] **Step 7: Verify OpenRouter LLM call**

Trigger an AI-using flow (e.g., draft an outreach message). Watch logs for the model id (`anthropic/claude-sonnet-4.6`) — confirm a successful response.

Or, run a quick smoke test directly:

```bash
docker exec harbinger-app node -e "
const { generateText } = require('ai');
const { getModel } = require('./.next/server/chunks/lib/ai/provider.js'); // path may vary
generateText({ model: getModel('openai/gpt-4o-mini'), prompt: 'Say hi' })
  .then(r => console.log(r.text))
  .catch(console.error);
" || echo "Use the UI flow instead — module path varies in standalone build"
```

Expected: text response.

- [ ] **Step 8: Verify metrics endpoint**

```bash
curl -s http://localhost:3000/api/metrics | head -20
```

Expected: Prometheus-format output starting with `# HELP harbinger_*`.

- [ ] **Step 9: Verify Sentry receives a test error**

If `SENTRY_DSN` is configured in `.env.local`, hit a route that throws (or temporarily add one):

```bash
curl -s http://localhost:3000/api/__sentry-test
# or whatever throw-route you wired (remove before committing)
```

Then check Sentry dashboard for the captured event.

- [ ] **Step 10: Cleanup**

```bash
docker compose down
```

- [ ] **Step 11: Commit any verification fixes**

If steps 1–10 surfaced bugs, fix them and commit:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Local verification: address issues found in Phase 3 smoke tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 4 — Railway Deployment

## Task 20: Create Railway project and provision Postgres

- [ ] **Step 1: Install Railway CLI (if not installed)**

```bash
which railway || curl -fsSL https://railway.app/install.sh | sh
railway --version
```

- [ ] **Step 2: Log in**

```bash
railway login
```

(Browser-based device flow.)

- [ ] **Step 3: Create project and link**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
railway init
# Choose: Empty Project
# Name: champ-harbinger
railway link
```

- [ ] **Step 4: Provision Postgres plugin**

Use Railway dashboard (faster than CLI for plugin add): visit project → "+ New" → "Database" → "Postgres". Wait for provision.

Alternatively:

```bash
railway add --plugin postgresql
```

- [ ] **Step 5: Confirm DATABASE_URL injected**

Railway auto-injects `DATABASE_URL` referencing the Postgres plugin into the app service. Verify in dashboard → service → Variables.

## Task 21: Configure Railway environment variables

- [ ] **Step 1: Set required vars via dashboard or CLI**

```bash
cd /Users/deep/Apps\&Projects/ChampHarbinger
railway variables --set "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_..." \
                  --set "CLERK_SECRET_KEY=sk_live_..." \
                  --set "OPENROUTER_API_KEY=sk-or-v1-..." \
                  --set "HARBINGER_DEFAULT_MODEL=anthropic/claude-sonnet-4.6" \
                  --set "HARBINGER_NODE_ENV=staging" \
                  --set "NEXT_TELEMETRY_DISABLED=1"
```

- [ ] **Step 2: Optional vars**

Set Sentry, Browserbase, Exa, etc. only if you want them on staging:

```bash
railway variables --set "SENTRY_DSN=..." \
                  --set "NEXT_PUBLIC_SENTRY_DSN=..."
```

- [ ] **Step 3: Public URL gets injected after first deploy**

`NEXT_PUBLIC_HARBINGER_APP_URL` should reference the Railway-assigned domain. After first deploy, run:

```bash
railway domain
# Note the *.up.railway.app URL, then:
railway variables --set "NEXT_PUBLIC_HARBINGER_APP_URL=https://<your-domain>.up.railway.app"
```

## Task 22: Configure Railway build (Dockerfile + release command)

- [ ] **Step 1: Add `railway.json`**

Create `/Users/deep/Apps&Projects/ChampHarbinger/railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/metrics",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

- [ ] **Step 2: Add a release-phase migration script**

Railway's "Pre-Deploy Command" runs migrations before the new container starts taking traffic. Set it via dashboard → service → Settings → Pre-Deploy Command:

```
pnpm db:migrate
```

(If the standalone build doesn't include `pnpm`, use `node ./node_modules/drizzle-kit/bin.cjs migrate` or include drizzle-kit's CLI shim explicitly. Verify in Step 4.)

- [ ] **Step 3: Commit railway.json**

```bash
git add railway.json
git commit -m "$(cat <<'EOF'
Add railway.json: Dockerfile builder + healthcheck on /api/metrics

Pre-Deploy Command (set in Railway dashboard) runs pnpm db:migrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 23: Deploy

- [ ] **Step 1: Push to Railway**

If a GitHub repo is linked, push to the tracked branch. Otherwise:

```bash
railway up
```

- [ ] **Step 2: Watch build logs**

```bash
railway logs --deployment
```

Expected: Docker build succeeds; container boots; healthcheck passes.

- [ ] **Step 3: If Pre-Deploy migration failed**

Common cause: `pnpm` not on PATH in the standalone runner. Workaround — add a script that runs migrations using node directly:

Create `scripts/migrate.mjs`:

```js
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);
await migrate(db, { migrationsFolder: './db/migrations' });
await sql.end();
console.log('migrations applied');
```

Add to `package.json`:

```json
"scripts": {
  "db:migrate:prod": "node scripts/migrate.mjs"
}
```

Update Pre-Deploy Command to: `node scripts/migrate.mjs`. Redeploy.

## Task 24: Verify Phase 2 verification gates

- [ ] **Step 1: Get the deployed URL**

```bash
railway domain
```

- [ ] **Step 2: Verify reachability**

```bash
curl -sI https://<url>/
```

Expected: `200 OK`.

- [ ] **Step 3: Verify rebrand**

```bash
curl -s https://<url>/ | grep -i 'ChampHarbinger' | head -3
```

Expected: ChampHarbinger present.

- [ ] **Step 4: Add the deployed URL to Clerk allowed origins**

In Clerk dashboard → JWT Templates / CORS / Allowed Origins, add `https://<url>` so login works.

- [ ] **Step 5: Verify Clerk login works against deployed URL**

Manual: open the deployed URL in a browser, sign in, confirm redirect.

- [ ] **Step 6: Verify a tenant-scoped DB write end-to-end**

Manual: create a record via the UI; verify in Railway Postgres console (or `railway connect Postgres` then `psql`).

- [ ] **Step 7: Verify OpenRouter call works in deployed env**

Trigger an AI flow. Check logs:

```bash
railway logs
```

Expected: successful AI response, no auth errors.

- [ ] **Step 8: Verify `/api/metrics` reachable**

```bash
curl -s https://<url>/api/metrics | head -20
```

Expected: Prometheus output. (For production, you'd IP-restrict this; v1 leaves it open as documented in non-goals.)

- [ ] **Step 9: Verify Sentry captures errors from Railway**

If Sentry configured: trigger a deliberate error route, check the Sentry dashboard for an event with environment=staging.

- [ ] **Step 10: Document the URL and credentials**

Update `README.md` (or create `docs/STAGING.md`) with:
- Deployed Railway URL
- How to access Postgres console (Railway dashboard / `railway connect`)
- Where Clerk live keys live
- Sentry project link (if enabled)

```bash
git add docs/STAGING.md
git commit -m "$(cat <<'EOF'
Document Railway staging deployment URL and access points

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Done

At this point:
- `main` contains the full ChampHarbinger app (rebranded, Drizzle-backed, OpenRouter LLM, monitoring wired)
- Local stack runs via `docker compose up`
- Railway hosts a staging deployment
- All Phase 1 + Phase 2 verification gates pass

**Optional follow-ups** (out of v1 scope, not in this plan):
- ChampMail integration when ready (replaces `StubEmailProvider`)
- Lake B2B / LakeStream data enrichment integration
- Custom-designed harbinger logo
- Production hardening (autoscaling, multi-region, IP allowlist for `/metrics`)
- Brand voice review with Champions Group marketing
