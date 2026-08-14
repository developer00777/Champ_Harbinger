import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the missing-publishable-key path in src/proxy.ts.
 *
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is inlined at BUILD time. When a deploy
 * forgets to pass it as a Docker build arg, clerkMiddleware() throws while
 * instantiating — on every request, before the public-route check runs — which
 * surfaced only as an opaque Railway "Healthcheck failure".
 *
 * The proxy now detects that case explicitly. The SECURITY-CRITICAL property
 * these tests lock in: the degraded path must never let a request through to a
 * protected route. It fails closed with 503; only the unauthenticated
 * health/metrics endpoint is allowed to proceed.
 */

const ORIGINAL_ENV = { ...process.env };

/** clerkMiddleware is stubbed so tests exercise OUR wrapper, not Clerk. */
const clerkHandlerCalls: string[] = [];
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: () => (request: Request) => {
    clerkHandlerCalls.push(new URL(request.url).pathname);
    return new Response("clerk-handled", { status: 200 });
  },
  createRouteMatcher: () => () => false,
}));

async function callProxy(pathname: string) {
  const { proxy } = await import("./proxy");
  const request = new Request(`https://example.com${pathname}`);
  // The real signature takes (request, event); the event is unused here.
  return (
    proxy as unknown as (
      r: Request,
      e?: unknown,
    ) => Promise<Response | undefined>
  )(request, undefined);
}

beforeEach(() => {
  vi.resetModules();
  clerkHandlerCalls.length = 0;
  process.env = { ...ORIGINAL_ENV };
  delete process.env.DEV_AUTH_BYPASS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("proxy — missing Clerk publishable key", () => {
  it("fails a protected route CLOSED with 503 instead of throwing", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const res = await callProxy("/dashboard");
    expect(res?.status).toBe(503);
    // Never reached Clerk, and never treated as authenticated.
    expect(clerkHandlerCalls).toEqual([]);
  });

  it("names the build-arg fix in the error body so the cause is diagnosable", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const res = await callProxy("/settings");
    const body = (await res!.json()) as { detail?: string };
    expect(body.detail).toMatch(/BUILD ARG/i);
    expect(body.detail).toMatch(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });

  it("lets /api/metrics through so the container can still report healthy", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const res = await callProxy("/api/metrics");
    expect(res).toBeUndefined(); // undefined => continue to the route handler
  });

  it("treats a whitespace-only key as missing", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "   ";
    const res = await callProxy("/dashboard");
    expect(res?.status).toBe(503);
  });

  it("delegates to Clerk normally once the key is present", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_abc123";
    const res = await callProxy("/dashboard");
    expect(res?.status).toBe(200);
    expect(clerkHandlerCalls).toEqual(["/dashboard"]);
  });

  it("delegates to Clerk for /api/metrics too when configured (no bypass)", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_abc123";
    await callProxy("/api/metrics");
    // The real middleware handles it via isPublicRoute; the point is that our
    // wrapper does not short-circuit when the key IS present.
    expect(clerkHandlerCalls).toEqual(["/api/metrics"]);
  });
});
