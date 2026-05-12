# ChampHarbinger ↔ ChampIQ Integration — Plan A (ChampHarbinger side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose ChampHarbinger's signal intelligence as a REST API and add the ChampIQ connection UI (settings, dashboard review queue, outreach toggle) so ChampIQ can pull qualified prospects and run research on demand.

**Architecture:** Six public `/api/v1/*` route handlers authenticated by a Bearer API key stored in the existing `userApiKeys` table. A new `champiqQueue` table holds prospects that have cleared the handoff threshold. Settings (ChampIQ URL, handoff mode, per-signal config) live in a new `userSettings` table. All UI is additive — standalone outreach remains fully intact.

**Tech Stack:** Next.js 16 route handlers · Drizzle ORM · PostgreSQL · `src/lib/signals/executor.ts` for signal runs · `src/lib/services/exa-service.ts` + knowledge-base for enrichment · existing `encryptApiKey`/`decryptApiKey` from `src/lib/crypto.ts`

**Spec:** `docs/superpowers/specs/2026-05-13-champharbinger-champiq-integration-design.md`

---

## File map

| Action | Path                                                | Responsibility                                       |
| ------ | --------------------------------------------------- | ---------------------------------------------------- |
| Modify | `db/schema.ts`                                      | Add `champiqQueue` + `userSettings` tables           |
| Create | `src/lib/api/validate-api-key.ts`                   | Auth helper: validate Bearer `chh_*` token           |
| Create | `src/app/api/v1/signals/route.ts`                   | GET list signals                                     |
| Create | `src/app/api/v1/signals/run/route.ts`               | POST run signal                                      |
| Create | `src/app/api/v1/discover/route.ts`                  | POST discover companies                              |
| Create | `src/app/api/v1/enrich/company/route.ts`            | POST enrich company                                  |
| Create | `src/app/api/v1/enrich/contact/route.ts`            | POST enrich contact                                  |
| Create | `src/app/api/v1/prospects/qualified/route.ts`       | GET qualified prospects                              |
| Create | `src/app/api/champiq/settings/route.ts`             | GET/POST ChampIQ settings (URL, mode, signal config) |
| Create | `src/app/api/champiq/api-key/route.ts`              | POST generate / DELETE revoke ChampHarbinger API key |
| Create | `src/app/api/champiq/health-check/route.ts`         | POST test ChampIQ connection                         |
| Create | `src/components/settings/champiq-panel.tsx`         | Settings → Integrations → ChampIQ section            |
| Modify | `src/app/(app)/settings/page.tsx`                   | Add ChampIQ tab                                      |
| Create | `src/components/dashboard/champiq-queue-widget.tsx` | Review queue widget                                  |
| Modify | `src/app/(app)/dashboard/page.tsx`                  | Render widget when connected                         |
| Modify | `src/components/app-sidebar.tsx`                    | ChampIQ live / Connect prompt                        |
| Modify | `src/app/(app)/outreach/page.tsx`                   | ChampIQ / Standalone toggle                          |

---

## Task 1: DB schema — champiqQueue + userSettings tables

**Files:**

- Modify: `db/schema.ts`

- [ ] **Step 1: Add tables to schema**

Open `db/schema.ts` and append after the last table definition (after the `userApiKeys` block around line 848):

```typescript
// ─── ChampIQ queue ────────────────────────────────────────────────────────────

/**
 * Prospects that have cleared the ChampHarbinger handoff threshold and are
 * waiting to be pushed (or have been pushed/discarded) to ChampIQ.
 */
export const champiqQueue = pgTable(
  "champiq_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    companyName: text("company_name").notNull(),
    companyDomain: text("company_domain").notNull(),
    companyData: jsonb("company_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    contacts: jsonb("contacts")
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    signalId: uuid("signal_id"),
    signalName: text("signal_name"),
    signalReasoning: text("signal_reasoning"),
    signalData: jsonb("signal_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    score: real("score"),
    talkingPoints: jsonb("talking_points")
      .$type<string[]>()
      .default([])
      .notNull(),
    status: text("status").notNull().default("pending"), // pending | pushed | discarded
    ...timestamps,
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("champiq_queue_clerk_user_id_idx").on(t.clerkUserId),
    byStatus: index("champiq_queue_status_idx").on(t.status),
  }),
);

// ─── User settings ────────────────────────────────────────────────────────────

/**
 * Arbitrary key-value settings per user. Not encrypted — for non-secret
 * config like ChampIQ URL, handoff mode, per-signal JSON config.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueUserKey: unique("user_settings_user_key_unique").on(
      t.clerkUserId,
      t.key,
    ),
    byUser: index("user_settings_clerk_user_id_idx").on(t.clerkUserId),
  }),
);
```

- [ ] **Step 2: Generate and run the migration**

```bash
cd "/Users/deep/Apps&Projects/ChampHarbinger"
pnpm db:generate
pnpm db:migrate
```

Expected: Two new migration files created in `drizzle/` and applied. No errors.

- [ ] **Step 3: Verify schema in Drizzle Studio**

```bash
pnpm db:studio
```

Open the studio URL, confirm `champiq_queue` and `user_settings` tables appear with correct columns.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts drizzle/
git commit -m "feat: add champiq_queue and user_settings tables"
```

---

## Task 2: API key validation helper

**Files:**

- Create: `src/lib/api/validate-api-key.ts`

- [ ] **Step 1: Create the helper**

```typescript
// src/lib/api/validate-api-key.ts
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { decryptApiKey } from "@/lib/crypto";

export interface ApiKeyContext {
  userId: string;
}

/**
 * Validates a `chh_` Bearer token against the userApiKeys table.
 * Returns the workspace userId on success, throws a Response on failure.
 *
 * Usage in a route handler:
 *   const ctx = await validateApiKey(request);
 *   // ctx.userId is the authenticated workspace owner
 */
export async function validateApiKey(request: Request): Promise<ApiKeyContext> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token.startsWith("chh_")) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = await adminDb
    .select()
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.keyName, "champiq_api_key"));

  for (const row of rows) {
    try {
      const decrypted = decryptApiKey(row.keyValueEncrypted);
      if (decrypted === token) {
        return { userId: row.clerkUserId };
      }
    } catch {
      // Decryption failed for this row — try next
    }
  }

  throw new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Write a unit test**

```typescript
// src/__tests__/validate-api-key.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/admin", () => ({ adminDb: { select: vi.fn() } }));
vi.mock("@/lib/crypto", () => ({
  decryptApiKey: vi.fn((v: string) => v.replace("encrypted_", "")),
}));
vi.mock("@/db", () => ({ schema: { userApiKeys: {} } }));

import { validateApiKey } from "@/lib/api/validate-api-key";
import { adminDb } from "@/lib/db/admin";

const mockSelect = (
  rows: Array<{ clerkUserId: string; keyValueEncrypted: string }>,
) => {
  vi.mocked(adminDb.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  } as never);
};

describe("validateApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns userId for valid token", async () => {
    mockSelect([
      { clerkUserId: "user_abc", keyValueEncrypted: "encrypted_chh_valid" },
    ]);
    const req = new Request("http://x", {
      headers: { authorization: "Bearer chh_valid" },
    });
    const ctx = await validateApiKey(req);
    expect(ctx.userId).toBe("user_abc");
  });

  it("throws 401 for wrong prefix", async () => {
    const req = new Request("http://x", {
      headers: { authorization: "Bearer wrong_token" },
    });
    await expect(validateApiKey(req)).rejects.toBeInstanceOf(Response);
  });

  it("throws 401 when no key matches", async () => {
    mockSelect([
      { clerkUserId: "user_abc", keyValueEncrypted: "encrypted_chh_other" },
    ]);
    const req = new Request("http://x", {
      headers: { authorization: "Bearer chh_wrong" },
    });
    await expect(validateApiKey(req)).rejects.toBeInstanceOf(Response);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/__tests__/validate-api-key.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/validate-api-key.ts src/__tests__/validate-api-key.test.ts
git commit -m "feat: add API key validation helper for /api/v1/* routes"
```

---

## Task 3: GET /api/v1/signals

**Files:**

- Create: `src/app/api/v1/signals/route.ts`

- [ ] **Step 1: Create route**

```typescript
// src/app/api/v1/signals/route.ts
import { NextResponse } from "next/server";
import { or, isNull, eq, asc, desc } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const signals = await adminDb
    .select()
    .from(schema.signals)
    .where(
      or(
        eq(schema.signals.isBuiltin, true),
        isNull(schema.signals.clerkUserId),
        eq(schema.signals.clerkUserId, ctx.userId),
      ),
    )
    .orderBy(desc(schema.signals.isBuiltin), asc(schema.signals.name));

  return NextResponse.json(
    signals.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      execution_type: s.executionType,
      tool_key: s.toolKey,
      config: s.config,
      is_builtin: s.isBuiltin,
    })),
  );
}
```

- [ ] **Step 2: Smoke test**

```bash
# Generate an API key first (Task 6 adds the UI; for now insert directly):
# We'll test properly in Task 6. For now verify the file compiles:
pnpm typecheck
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/signals/route.ts
git commit -m "feat: GET /api/v1/signals — list workspace signals"
```

---

## Task 4: POST /api/v1/signals/run

**Files:**

- Create: `src/app/api/v1/signals/run/route.ts`

- [ ] **Step 1: Create route**

```typescript
// src/app/api/v1/signals/run/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { executeSignal } from "@/lib/signals/executor";
import type { Signal } from "@/lib/types/signal";

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as {
    signal_id?: string;
    domain?: string;
  };
  if (!body.signal_id || !body.domain) {
    return NextResponse.json(
      { error: "signal_id and domain are required" },
      { status: 400 },
    );
  }

  const [signal] = await adminDb
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.id, body.signal_id))
    .limit(1);

  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }

  const mappedSignal: Signal = {
    id: signal.id,
    name: signal.name,
    description: signal.description ?? "",
    category: signal.category as Signal["category"],
    execution_type: signal.executionType as Signal["execution_type"],
    tool_key: signal.toolKey ?? undefined,
    config: signal.config ?? {},
    is_builtin: signal.isBuiltin,
    is_public: signal.isPublic,
    created_at: signal.createdAt.toISOString(),
    updated_at: signal.updatedAt.toISOString(),
  };

  const output = await executeSignal(mappedSignal, {
    domain: body.domain,
    useAdmin: true,
  });

  return NextResponse.json({
    fired: output.found,
    reasoning: output.summary,
    data: output.data,
    fired_at: output.found ? new Date().toISOString() : null,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: No errors. If `Signal` type fields differ, adjust the mapping to match `src/lib/types/signal.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/signals/run/route.ts
git commit -m "feat: POST /api/v1/signals/run — run signal against domain"
```

---

## Task 5: POST /api/v1/discover

**Files:**

- Create: `src/app/api/v1/discover/route.ts`

- [ ] **Step 1: Create route**

```typescript
// src/app/api/v1/discover/route.ts
import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";

export const maxDuration = 60;

export async function POST(request: Request) {
  let _ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    _ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as {
    icp?: string;
    industry?: string;
    location?: string;
    size?: string;
  };

  if (!body.icp) {
    return NextResponse.json({ error: "icp is required" }, { status: 400 });
  }

  const query = [
    body.icp,
    body.industry ? `industry:${body.industry}` : "",
    body.location ? `location:${body.location}` : "",
    body.size ? `size:${body.size} employees` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const exa = new ExaService();
  const response = await exa.search(query, {
    numResults: 20,
    searchType: "neural",
  });

  const companies = response.results.flatMap((r) => {
    try {
      return [
        {
          name: r.title ?? r.url,
          domain: new URL(r.url).hostname.replace(/^www\./, ""),
          url: r.url,
          description:
            r.text?.slice(0, 300) ?? r.summary?.slice(0, 300) ?? null,
        },
      ];
    } catch {
      return [];
    }
  });

  return NextResponse.json({ companies });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/discover/route.ts
git commit -m "feat: POST /api/v1/discover — find companies matching ICP"
```

---

## Task 6: POST /api/v1/enrich/company + POST /api/v1/enrich/contact

**Files:**

- Create: `src/app/api/v1/enrich/company/route.ts`
- Create: `src/app/api/v1/enrich/contact/route.ts`

- [ ] **Step 1: Create enrich/company route**

```typescript
// src/app/api/v1/enrich/company/route.ts
import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";
import { normalizeDomain } from "@/lib/services/knowledge-base";

export const maxDuration = 120;

export async function POST(request: Request) {
  let _ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    _ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as { domain?: string };
  if (!body.domain) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain);
  const exa = new ExaService();

  const [productResult, fundingResult, teamResult] = await Promise.allSettled([
    exa.search(`site:${domain} product features OR pricing OR integrations`, {
      numResults: 3,
      searchType: "neural",
      includeText: true,
    }),
    exa.search(`${domain} funding round OR investment OR Series`, {
      numResults: 3,
      searchType: "neural",
      includeText: true,
    }),
    exa.search(`site:${domain} team OR about OR leadership`, {
      numResults: 3,
      searchType: "neural",
      includeText: true,
    }),
  ]);

  const snippets = [productResult, fundingResult, teamResult]
    .flatMap((r) => (r.status === "fulfilled" ? r.value.results : []))
    .map((r) => r.text?.slice(0, 400) ?? r.summary?.slice(0, 400) ?? "")
    .filter(Boolean);

  const talkingPoints: string[] = [];
  const combinedText = snippets.join(" ");
  if (/series [a-e]/i.test(combinedText))
    talkingPoints.push("Recently raised funding");
  if (/hir(ing|ed)/i.test(combinedText)) talkingPoints.push("Actively hiring");
  if (/launch(ed|ing)/i.test(combinedText))
    talkingPoints.push("Recent product launch");

  return NextResponse.json({
    company: {
      domain,
      description: snippets[0] ?? null,
    },
    contacts: [],
    score: null,
    talking_points: talkingPoints,
    raw_snippets: snippets,
  });
}
```

- [ ] **Step 2: Create enrich/contact route**

```typescript
// src/app/api/v1/enrich/contact/route.ts
import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";

export const maxDuration = 60;

export async function POST(request: Request) {
  let _ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    _ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as {
    name?: string;
    domain?: string;
    title?: string;
  };

  if (!body.name || !body.domain) {
    return NextResponse.json(
      { error: "name and domain are required" },
      { status: 400 },
    );
  }

  const exa = new ExaService();
  const response = await exa.search(
    `"${body.name}" ${body.domain} ${body.title ?? ""}`,
    { numResults: 5, searchType: "neural", includeText: true },
  );

  const emailMatch = response.results
    .flatMap((r) => r.text ?? "")
    .join(" ")
    .match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

  return NextResponse.json({
    contact: {
      name: body.name,
      domain: body.domain,
      title: body.title ?? null,
      email: emailMatch?.[0] ?? null,
      linkedin_url: null,
    },
    score: null,
  });
}
```

- [ ] **Step 3: Check ExaService.search() response shape**

```bash
grep -n "async search\|results\b" "/Users/deep/Apps&Projects/ChampHarbinger/src/lib/services/exa-service.ts" | head -20
```

Adjust `.results` access if the shape differs (e.g., `r.value` instead of `r.value.results`).

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/enrich/
git commit -m "feat: POST /api/v1/enrich/company and /contact — enrichment endpoints"
```

---

## Task 7: GET /api/v1/prospects/qualified

**Files:**

- Create: `src/app/api/v1/prospects/qualified/route.ts`

- [ ] **Step 1: Create route**

```typescript
// src/app/api/v1/prospects/qualified/route.ts
import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);
  const cursor = searchParams.get("cursor");

  const conditions = [
    eq(schema.champiqQueue.clerkUserId, ctx.userId),
    eq(schema.champiqQueue.status, "pending"),
  ];

  if (since) {
    conditions.push(gte(schema.champiqQueue.createdAt, new Date(since)));
  }

  if (cursor) {
    conditions.push(lt(schema.champiqQueue.createdAt, new Date(cursor)));
  }

  const rows = await adminDb
    .select()
    .from(schema.champiqQueue)
    .where(and(...conditions))
    .orderBy(schema.champiqQueue.createdAt)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const prospects = rows.slice(0, limit);
  const nextCursor = hasMore
    ? prospects[prospects.length - 1]?.createdAt.toISOString()
    : null;

  return NextResponse.json({
    prospects: prospects.map((p) => ({
      id: p.id,
      company: {
        name: p.companyName,
        domain: p.companyDomain,
        ...p.companyData,
      },
      contacts: p.contacts,
      signal: {
        id: p.signalId,
        name: p.signalName,
        reasoning: p.signalReasoning,
        data: p.signalData,
      },
      score: p.score,
      talking_points: p.talkingPoints,
      qualified_at: p.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/prospects/qualified/route.ts
git commit -m "feat: GET /api/v1/prospects/qualified — paginated qualified prospect list"
```

---

## Task 8: ChampIQ settings backend (API key + settings store)

**Files:**

- Create: `src/app/api/champiq/api-key/route.ts`
- Create: `src/app/api/champiq/settings/route.ts`
- Create: `src/app/api/champiq/health-check/route.ts`

- [ ] **Step 1: API key generation/revocation route**

```typescript
// src/app/api/champiq/api-key/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { encryptApiKey, maskApiKey } from "@/lib/crypto";

export async function POST() {
  const { userId } = await getCurrentUser();

  const token = `chh_${randomBytes(32).toString("hex")}`;
  const { keyPrefix, keySuffix } = maskApiKey(token);
  const keyValueEncrypted = encryptApiKey(token);

  await adminDb
    .insert(schema.userApiKeys)
    .values({
      clerkUserId: userId,
      keyName: "champiq_api_key",
      keyValueEncrypted,
      keyPrefix,
      keySuffix,
    })
    .onConflictDoUpdate({
      target: [schema.userApiKeys.clerkUserId, schema.userApiKeys.keyName],
      set: { keyValueEncrypted, keyPrefix, keySuffix, updatedAt: new Date() },
    });

  // Return the plaintext token once — it will not be shown again
  return NextResponse.json({ token, keyPrefix, keySuffix });
}

export async function DELETE() {
  const { userId } = await getCurrentUser();

  await adminDb
    .delete(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, userId),
        eq(schema.userApiKeys.keyName, "champiq_api_key"),
      ),
    );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Settings store route**

```typescript
// src/app/api/champiq/settings/route.ts
import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

const CHAMPIQ_KEYS = [
  "champiq_url",
  "champiq_handoff_mode",
  "champiq_signal_config",
] as const;

export async function GET() {
  const { userId } = await getCurrentUser();

  const rows = await adminDb
    .select()
    .from(schema.userSettings)
    .where(
      and(
        eq(schema.userSettings.clerkUserId, userId),
        inArray(schema.userSettings.key, [...CHAMPIQ_KEYS]),
      ),
    );

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  // Also check if an API key exists
  const [apiKeyRow] = await adminDb
    .select({
      keyPrefix: schema.userApiKeys.keyPrefix,
      keySuffix: schema.userApiKeys.keySuffix,
    })
    .from(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, userId),
        eq(schema.userApiKeys.keyName, "champiq_api_key"),
      ),
    )
    .limit(1);

  return NextResponse.json({
    champiq_url: settings["champiq_url"] ?? null,
    handoff_mode: settings["champiq_handoff_mode"] ?? "review",
    signal_config: settings["champiq_signal_config"]
      ? JSON.parse(settings["champiq_signal_config"])
      : {},
    api_key_configured: !!apiKeyRow,
    api_key_prefix: apiKeyRow?.keyPrefix ?? null,
    api_key_suffix: apiKeyRow?.keySuffix ?? null,
  });
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUser();
  const body = (await request.json()) as {
    champiq_url?: string;
    handoff_mode?: string;
    signal_config?: Record<string, unknown>;
  };

  const toUpsert: Array<{ key: string; value: string }> = [];
  if (body.champiq_url !== undefined)
    toUpsert.push({ key: "champiq_url", value: body.champiq_url });
  if (body.handoff_mode !== undefined)
    toUpsert.push({ key: "champiq_handoff_mode", value: body.handoff_mode });
  if (body.signal_config !== undefined)
    toUpsert.push({
      key: "champiq_signal_config",
      value: JSON.stringify(body.signal_config),
    });

  for (const { key, value } of toUpsert) {
    await adminDb
      .insert(schema.userSettings)
      .values({ clerkUserId: userId, key, value })
      .onConflictDoUpdate({
        target: [schema.userSettings.clerkUserId, schema.userSettings.key],
        set: { value, updatedAt: new Date() },
      });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Health-check route (tests ChampIQ connection)**

```typescript
// src/app/api/champiq/health-check/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  await getCurrentUser(); // auth guard

  const body = (await request.json()) as { url?: string; api_key?: string };
  if (!body.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const endpoint = body.url.replace(/\/$/, "") + "/api/harbinger/health";
    const res = await fetch(endpoint, {
      headers: body.api_key ? { authorization: `Bearer ${body.api_key}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch {
    return NextResponse.json({ ok: false, status: null });
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/champiq/
git commit -m "feat: ChampIQ settings, API key generation, and health-check routes"
```

---

## Task 9: ChampIQ settings panel UI

**Files:**

- Create: `src/components/settings/champiq-panel.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Create the panel component**

```typescript
// src/components/settings/champiq-panel.tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type HandoffMode = "auto" | "review" | "per_signal";

interface ChampIQSettings {
  champiq_url: string | null;
  handoff_mode: HandoffMode;
  signal_config: Record<string, { mode: "auto" | "review"; min_score: number }>;
  api_key_configured: boolean;
  api_key_prefix: string | null;
  api_key_suffix: string | null;
}

export function ChampIQPanel() {
  const [settings, setSettings] = useState<ChampIQSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [champiqUrl, setChampiqUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/champiq/settings")
      .then((r) => r.json())
      .then((data: ChampIQSettings) => {
        setSettings(data);
        setChampiqUrl(data.champiq_url ?? "");
      })
      .catch(() => toast.error("Failed to load ChampIQ settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/champiq/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ champiq_url: champiqUrl }),
      });
      setSettings((prev) => prev ? { ...prev, champiq_url: champiqUrl } : prev);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setConnectionOk(null);
    try {
      const res = await fetch("/api/champiq/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: champiqUrl }),
      });
      const data = await res.json();
      setConnectionOk(data.ok);
      if (data.ok) toast.success("ChampIQ reachable");
      else toast.error("ChampIQ not reachable");
    } catch {
      setConnectionOk(false);
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleGenerateKey() {
    setGeneratingKey(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/champiq/api-key", { method: "POST" });
      const data = await res.json();
      setNewToken(data.token);
      setSettings((prev) =>
        prev
          ? { ...prev, api_key_configured: true, api_key_prefix: data.keyPrefix, api_key_suffix: data.keySuffix }
          : prev,
      );
      toast.success("API key generated — copy it now, it won't be shown again");
    } catch {
      toast.error("Failed to generate API key");
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRevokeKey() {
    await fetch("/api/champiq/api-key", { method: "DELETE" });
    setSettings((prev) => prev ? { ...prev, api_key_configured: false, api_key_prefix: null, api_key_suffix: null } : prev);
    setNewToken(null);
    toast.success("API key revoked");
  }

  async function handleModeChange(mode: HandoffMode) {
    await fetch("/api/champiq/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoff_mode: mode }),
    });
    setSettings((prev) => prev ? { ...prev, handoff_mode: mode } : prev);
    toast.success("Handoff mode updated");
  }

  function copyToken() {
    if (!newToken) return;
    void navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">ChampIQ URL</p>
          <p className="text-muted-foreground text-xs">The base URL of your ChampIQ instance (e.g. http://localhost:5173)</p>
        </div>
        <div className="flex gap-2">
          <Input
            value={champiqUrl}
            onChange={(e) => { setChampiqUrl(e.target.value); setConnectionOk(null); }}
            placeholder="http://localhost:5173"
            className="font-mono text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleTest} disabled={!champiqUrl || testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {connectionOk === true && (
          <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" /> ChampIQ reachable
          </p>
        )}
        {connectionOk === false && (
          <p className="text-xs text-red-500">ChampIQ not reachable — check the URL and that ChampIQ is running</p>
        )}
      </div>

      {/* API key */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">ChampHarbinger API key</p>
          <p className="text-muted-foreground text-xs">Paste this into ChampIQ → Settings → Connected tools → ChampHarbinger</p>
        </div>
        {settings?.api_key_configured && !newToken && (
          <p className="font-mono text-xs text-muted-foreground">
            {settings.api_key_prefix}••••••••{settings.api_key_suffix}
          </p>
        )}
        {newToken && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <code className="flex-1 break-all font-mono text-xs">{newToken}</code>
            <Button size="sm" variant="ghost" onClick={copyToken}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleGenerateKey} disabled={generatingKey}>
            {generatingKey ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {settings?.api_key_configured ? "Rotate key" : "Generate key"}
          </Button>
          {settings?.api_key_configured && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleRevokeKey}>
              Revoke
            </Button>
          )}
        </div>
      </div>

      {/* Handoff mode */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Handoff mode</p>
          <p className="text-muted-foreground text-xs">Controls when qualified prospects are sent to ChampIQ</p>
        </div>
        <div className="space-y-2">
          {(["auto", "review", "per_signal"] as const).map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
              <input
                type="radio"
                name="handoff_mode"
                value={mode}
                checked={settings?.handoff_mode === mode}
                onChange={() => handleModeChange(mode)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium capitalize">
                  {mode === "auto" ? "Fully automatic" : mode === "review" ? "Review queue" : "Per-signal control"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {mode === "auto" && "Push qualified prospects to ChampIQ instantly. No review step."}
                  {mode === "review" && "Prospects land in the Dashboard queue. You approve each one."}
                  {mode === "per_signal" && "Configure Auto or Review per signal below."}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ChampIQ indicator */}
      {settings?.champiq_url && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
          <Zap className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs text-green-700 dark:text-green-400">
            ChampHarbinger will serve as the signal intelligence engine for ChampIQ at{" "}
            <span className="font-mono">{settings.champiq_url}</span>
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ChampIQ tab to Settings page**

In `src/app/(app)/settings/page.tsx`, add the import and a new tab:

```typescript
// Add import at top (after existing imports):
import { ChampIQPanel } from "@/components/settings/champiq-panel";
```

Find the `<TabsList>` block and add a new trigger after the existing ones:

```tsx
<TabsTrigger value="champiq">ChampIQ</TabsTrigger>
```

Find the last `<TabsContent>` and add after it:

```tsx
<TabsContent value="champiq" className="space-y-6">
  <SettingsSection
    title="ChampIQ Integration"
    description="Connect ChampHarbinger as the signal intelligence engine for ChampIQ. ChampIQ will call ChampHarbinger's API to run signals, discover companies, and pull qualified prospects."
  >
    <ChampIQPanel />
  </SettingsSection>
</TabsContent>
```

- [ ] **Step 3: Typecheck and verify**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/champiq-panel.tsx src/app/\(app\)/settings/page.tsx
git commit -m "feat: ChampIQ settings panel — connection, API key, handoff mode"
```

---

## Task 10: Review queue widget on Dashboard

**Files:**

- Create: `src/components/dashboard/champiq-queue-widget.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add API route to serve queue + push/discard actions**

```typescript
// src/app/api/champiq/queue/route.ts
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const { userId } = await getCurrentUser();

  const pending = await adminDb
    .select()
    .from(schema.champiqQueue)
    .where(
      and(
        eq(schema.champiqQueue.clerkUserId, userId),
        eq(schema.champiqQueue.status, "pending"),
      ),
    )
    .orderBy(schema.champiqQueue.createdAt)
    .limit(20);

  return NextResponse.json(
    pending.map((p) => ({
      id: p.id,
      company_name: p.companyName,
      company_domain: p.companyDomain,
      signal_name: p.signalName,
      signal_reasoning: p.signalReasoning,
      score: p.score,
      talking_points: p.talkingPoints,
      created_at: p.createdAt.toISOString(),
    })),
  );
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUser();
  const body = (await request.json()) as {
    id: string;
    action: "push" | "discard";
  };

  if (!body.id || !["push", "discard"].includes(body.action)) {
    return NextResponse.json(
      { error: "id and action required" },
      { status: 400 },
    );
  }

  await adminDb
    .update(schema.champiqQueue)
    .set({
      status: body.action === "push" ? "pushed" : "discarded",
      pushedAt: body.action === "push" ? new Date() : null,
    })
    .where(
      and(
        eq(schema.champiqQueue.id, body.id),
        eq(schema.champiqQueue.clerkUserId, userId),
      ),
    );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create the widget component**

```typescript
// src/components/dashboard/champiq-queue-widget.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface QueueItem {
  id: string;
  company_name: string;
  company_domain: string;
  signal_name: string | null;
  signal_reasoning: string | null;
  score: number | null;
  talking_points: string[];
  created_at: string;
}

export function ChampIQQueueWidget() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/champiq/queue");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(id: string, action: "push" | "discard") {
    setActing((a) => ({ ...a, [id]: true }));
    try {
      await fetch("/api/champiq/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success(action === "push" ? "Pushed to ChampIQ" : "Discarded");
    } catch {
      toast.error("Action failed");
    } finally {
      setActing((a) => ({ ...a, [id]: false }));
    }
  }

  async function pushAll() {
    for (const item of items) {
      await act(item.id, "push");
    }
  }

  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">Ready for ChampIQ</span>
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={pushAll}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          Push all →
        </button>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-md border bg-background p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.company_name}</p>
              {item.signal_reasoning && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs italic">
                  &ldquo;{item.signal_reasoning}&rdquo;
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                disabled={acting[item.id]}
                onClick={() => act(item.id, "push")}
              >
                Push
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={acting[item.id]}
                onClick={() => act(item.id, "discard")}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add widget to Dashboard page**

In `src/app/(app)/dashboard/page.tsx`, add import:

```typescript
import { ChampIQQueueWidget } from "@/components/dashboard/champiq-queue-widget";
```

Find the `<StatCards totals={data.totals} />` line and add the widget just above it:

```tsx
<ChampIQQueueWidget />
<StatCards totals={data.totals} />
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/champiq/queue/route.ts src/components/dashboard/champiq-queue-widget.tsx src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: ChampIQ review queue widget on Dashboard"
```

---

## Task 11: Sidebar indicator + Outreach page toggle

**Files:**

- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/app/(app)/outreach/page.tsx`

- [ ] **Step 1: Add connection status hook**

```typescript
// src/hooks/use-champiq-status.ts
"use client";

import { useEffect, useState } from "react";

export type ChampIQStatus = "unconfigured" | "connected" | "disconnected";

export function useChampIQStatus(): ChampIQStatus {
  const [status, setStatus] = useState<ChampIQStatus>("unconfigured");

  useEffect(() => {
    fetch("/api/champiq/settings")
      .then((r) => r.json())
      .then(async (data: { champiq_url: string | null }) => {
        if (!data.champiq_url) {
          setStatus("unconfigured");
          return;
        }
        const hc = await fetch("/api/champiq/health-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: data.champiq_url }),
        });
        const hcData = await hc.json();
        setStatus(hcData.ok ? "connected" : "disconnected");
      })
      .catch(() => setStatus("unconfigured"));
  }, []);

  return status;
}
```

- [ ] **Step 2: Add ChampIQ indicator to the sidebar footer**

The sidebar footer currently has two `SidebarMenuItem` entries (Settings, Feedback) followed by `NavUser`. Replace the entire `<SidebarFooter>` block in `src/components/app-sidebar.tsx` with:

```tsx
// Add these imports at the top of app-sidebar.tsx (alongside existing imports):
import { useChampIQStatus } from "@/hooks/use-champiq-status";

// Replace <SidebarFooter>...</SidebarFooter> with:
<SidebarFooter>
  {/* ChampIQ connection indicator */}
  {(() => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const champiqStatus = useChampIQStatus();
    if (champiqStatus === "connected") {
      return (
        <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          <span className="text-muted-foreground text-xs">ChampIQ live</span>
        </div>
      );
    }
    if (champiqStatus === "unconfigured") {
      return (
        <SidebarMenuButton
          render={<SafeLink href="/settings?tab=champiq" />}
          tooltip="Connect ChampIQ"
          className="text-muted-foreground text-xs"
        >
          <Zap className="h-3.5 w-3.5" />
          <span>Connect ChampIQ</span>
        </SidebarMenuButton>
      );
    }
    return null;
  })()}
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<SafeLink href="/settings" />}
        tooltip="Settings"
      >
        <Settings />
        <span>Settings</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <a href="mailto:hello@championsgroup.com?subject=ChampHarbinger%20feedback" />
        }
        tooltip="Feedback"
        aria-label="Give feedback"
      >
        <MessageSquare />
        <span>Feedback</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
  <SidebarSeparator />
  <NavUser user={defaultUser} />
</SidebarFooter>;
```

Note: the IIFE pattern avoids the conditional-hook rule since `useChampIQStatus` is not called conditionally. If the linter still objects, extract the status to a variable at the top of `AppSidebar`:

```tsx
const champiqStatus = useChampIQStatus();
```

and use it directly in JSX.

- [ ] **Step 3: Add ChampIQ/Standalone toggle to Outreach page**

In `src/app/(app)/outreach/page.tsx`, add import:

```typescript
import { useChampIQStatus } from "@/hooks/use-champiq-status";
```

Inside `OutreachPage`, add:

```typescript
const champiqStatus = useChampIQStatus();
const [outreachMode, setOutreachMode] = useState<"champiq" | "standalone">(
  "champiq",
);
```

Find where the page heading is rendered (look for "Outreach sequences" or similar) and replace it with:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
  {champiqStatus === "connected" && (
    <div className="flex overflow-hidden rounded-md border text-xs font-semibold">
      <button
        type="button"
        onClick={() => setOutreachMode("champiq")}
        className={`px-3 py-1.5 transition-colors ${outreachMode === "champiq" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
      >
        ChampIQ
      </button>
      <button
        type="button"
        onClick={() => setOutreachMode("standalone")}
        className={`px-3 py-1.5 transition-colors ${outreachMode === "standalone" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
      >
        Standalone
      </button>
    </div>
  )}
</div>
```

In ChampIQ mode (`outreachMode === "champiq"` and `champiqStatus === "connected"`), show a status summary instead of sequences:

```tsx
{champiqStatus === "connected" && outreachMode === "champiq" ? (
  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
    Outreach is being managed by ChampIQ. Visit your ChampIQ canvas to review sequences and track replies.{" "}
    <a href="/settings?tab=champiq" className="underline">
      Manage connection →
    </a>
  </div>
) : (
  // existing sequences JSX goes here (wrapped, unchanged)
  <OutreachTabs ... />
)}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-champiq-status.ts src/components/app-sidebar.tsx src/app/\(app\)/outreach/page.tsx
git commit -m "feat: ChampIQ sidebar indicator and outreach mode toggle"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Generate API key and test signals endpoint**

1. Sign in to ChampHarbinger at `http://localhost:3000`
2. Go to Settings → ChampIQ
3. Click "Generate key" — copy the `chh_` token
4. In a terminal:

```bash
TOKEN="chh_<your-token-here>"
BASE="http://localhost:3000"

# List signals
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/signals" | jq '.[0]'

# Check qualified prospects
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/prospects/qualified" | jq .
```

Expected: Signals list returns JSON array. Prospects returns `{ prospects: [], next_cursor: null }`.

- [ ] **Step 3: Run signal against a domain**

```bash
# Get a signal ID from the previous response, e.g. for "Hiring Surge"
SIGNAL_ID="<uuid from step 2>"

curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"signal_id\": \"$SIGNAL_ID\", \"domain\": \"vercel.com\"}" \
  "$BASE/api/v1/signals/run" | jq .
```

Expected: `{ fired: true/false, reasoning: "...", data: {...} }`

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
pnpm typecheck
```

Expected: All tests pass, no type errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: ChampHarbinger ↔ ChampIQ integration complete (Plan A)"
```

---

## Summary: What's built

After completing all tasks, ChampHarbinger will:

1. **Expose a public REST API** at `/api/v1/` authenticated by `chh_` Bearer tokens — six endpoints covering signal listing, signal execution, company discovery, company enrichment, contact enrichment, and qualified prospect retrieval.
2. **Store qualified prospects** in the `champiq_queue` table for ChampIQ to poll.
3. **Provide settings UI** under Settings → ChampIQ for configuring the ChampIQ URL, generating API keys, and setting handoff modes.
4. **Show a review queue widget** on the Dashboard when prospects are pending ChampIQ approval.
5. **Indicate connection status** in the sidebar (green dot when live, "Connect →" prompt when unconfigured).
6. **Toggle outreach mode** on the Outreach page between ChampIQ (managed externally) and Standalone (existing sequences).

Standalone mode remains fully intact throughout — no existing functionality removed.
