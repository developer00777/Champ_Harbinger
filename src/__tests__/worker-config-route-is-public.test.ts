import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression cover for: GET /api/internal/worker-config is authenticated by
 * its own x-worker-secret check (see route.ts), not a Clerk session — the
 * worker has no Clerk session to send. Adding a new internal route without
 * also adding it to src/proxy.ts's isPublicRoute matcher means Clerk's
 * middleware intercepts the request FIRST and returns its own 404
 * (dev-keys behaviour: `x-clerk-auth-reason: dev-browser-missing`) before
 * the route handler — and therefore its real auth logic — ever runs.
 *
 * This exact failure shipped once: the route 404'd on every request
 * regardless of whether the secret header was correct, and the cause was
 * invisible from the route's own code or its unit tests (which call GET()
 * directly and never go through proxy.ts).
 */

const root = join(__dirname, "..", "..");
const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");

describe("worker-secret-authed internal routes are public in proxy.ts", () => {
  it("lists /api/internal/worker-config as a public route", () => {
    expect(proxySource).toMatch(/["']\/api\/internal\/worker-config["']/);
  });
});
