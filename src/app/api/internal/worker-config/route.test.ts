import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/internal/worker-config hands the worker its provider keys
 * (OpenRouter, PDL, InboxKit, ...) so the worker never needs its own copy —
 * see src/lib/jobs/worker-config.ts for the consuming side. Because this
 * route returns live secrets, its auth is stricter than the other internal
 * routes: unset WORKER_SECRET means deny (404), not the dev-friendly
 * allow-through that verifyWorkerSecret() uses elsewhere.
 */

const ORIGINAL_ENV = { ...process.env };

async function callGet(headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const req = new Request("http://x/api/internal/worker-config", {
    headers,
  });
  return GET(req);
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/internal/worker-config", () => {
  it("404s when WORKER_SECRET is unset, even with a header supplied", async () => {
    delete process.env.WORKER_SECRET;
    const res = await callGet({ "x-worker-secret": "anything" });
    expect(res.status).toBe(404);
  });

  it("404s when the secret header is wrong", async () => {
    process.env.WORKER_SECRET = "correct-secret";
    const res = await callGet({ "x-worker-secret": "wrong-secret" });
    expect(res.status).toBe(404);
  });

  it("404s when no secret header is sent", async () => {
    process.env.WORKER_SECRET = "correct-secret";
    const res = await callGet();
    expect(res.status).toBe(404);
  });

  it("returns allowlisted keys that are set", async () => {
    process.env.WORKER_SECRET = "correct-secret";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.INBOXKIT_API_KEY = "ik-key";
    process.env.CORESIGNAL_API_KEY = "cs-key";
    const res = await callGet({ "x-worker-secret": "correct-secret" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: Record<string, string> };
    expect(body.config.OPENROUTER_API_KEY).toBe("or-key");
    expect(body.config.INBOXKIT_API_KEY).toBe("ik-key");
    expect(body.config.CORESIGNAL_API_KEY).toBe("cs-key");
  });

  it("never returns infra secrets even if they somehow matched an allowed name", async () => {
    process.env.WORKER_SECRET = "correct-secret";
    process.env.DATABASE_URL = "postgres://leak-me-not";
    process.env.CLERK_SECRET_KEY = "sk_should_not_leak";
    process.env.HARBINGER_SECRET = "hb_should_not_leak";
    const res = await callGet({ "x-worker-secret": "correct-secret" });
    const body = (await res.json()) as { config: Record<string, string> };
    expect(body.config.DATABASE_URL).toBeUndefined();
    expect(body.config.CLERK_SECRET_KEY).toBeUndefined();
    expect(body.config.HARBINGER_SECRET).toBeUndefined();
    expect(body.config.WORKER_SECRET).toBeUndefined();
  });

  it("omits keys that are unset or empty rather than returning empty strings", async () => {
    process.env.WORKER_SECRET = "correct-secret";
    delete process.env.APOLLO_API_KEY;
    process.env.PDL_API_KEY = "";
    const res = await callGet({ "x-worker-secret": "correct-secret" });
    const body = (await res.json()) as { config: Record<string, string> };
    expect(body.config.APOLLO_API_KEY).toBeUndefined();
    expect(body.config.PDL_API_KEY).toBeUndefined();
  });

  /**
   * The serving allowlist (this route) and the applying allowlist
   * (src/lib/jobs/worker-config.ts) are duplicated on purpose: the worker
   * script doesn't share a build with Next.js route files, so it can't import
   * from here. That makes silent drift possible — a key added to this route
   * but not to the worker is served and then dropped on the floor, so the
   * worker runs with the key missing and no error anywhere. Compare the two
   * source files directly to catch it.
   */
  it("keeps its allowlist in sync with the worker-side allowlist", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const extract = (source: string, pattern: RegExp) => {
      const block = source.match(pattern);
      if (!block) throw new Error("ALLOWED_KEYS block not found");
      return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    };

    const root = process.cwd();
    const routeKeys = extract(
      readFileSync(
        join(root, "src/app/api/internal/worker-config/route.ts"),
        "utf8",
      ),
      /ALLOWED_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/,
    );
    const workerKeys = extract(
      readFileSync(join(root, "src/lib/jobs/worker-config.ts"), "utf8"),
      /ALLOWED_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );

    expect(routeKeys.size).toBeGreaterThan(0);
    // Report the actual difference, so a failure names the drifting keys.
    expect([...routeKeys].filter((k) => !workerKeys.has(k))).toEqual([]);
    expect([...workerKeys].filter((k) => !routeKeys.has(k))).toEqual([]);
  });
});
