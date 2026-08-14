import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the local auth bypass (src/lib/dev-auth.ts).
 *
 * The bypass disables the Clerk session gate, so the ONLY thing standing
 * between it and an unauthenticated production deploy is the
 * `NODE_ENV !== "production"` half of the condition. Railway, Vercel, and
 * `next build`/`next start` all set NODE_ENV=production, which is what makes
 * committing DEV_AUTH_BYPASS=1 in a local .env safe.
 *
 * If someone removes that check, these tests fail loudly. Do not relax them.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV is typed readonly; tests legitimately need to vary it.
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("dev auth bypass", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV ?? "test");
    delete process.env.DEV_AUTH_BYPASS;
    vi.resetModules();
  });

  it("is OFF in production even when DEV_AUTH_BYPASS=1 (the critical guarantee)", async () => {
    process.env.DEV_AUTH_BYPASS = "1";
    setNodeEnv("production");
    const { isDevAuthBypass } = await import("./dev-auth");
    expect(isDevAuthBypass()).toBe(false);
  });

  it("is OFF outside production when the flag is unset", async () => {
    delete process.env.DEV_AUTH_BYPASS;
    setNodeEnv("development");
    const { isDevAuthBypass } = await import("./dev-auth");
    expect(isDevAuthBypass()).toBe(false);
  });

  it('is OFF when the flag is any value other than exactly "1"', async () => {
    setNodeEnv("development");
    for (const value of ["0", "true", "yes", ""]) {
      process.env.DEV_AUTH_BYPASS = value;
      vi.resetModules();
      const { isDevAuthBypass } = await import("./dev-auth");
      expect(isDevAuthBypass(), `flag=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('is ON only with the flag set to "1" outside production', async () => {
    process.env.DEV_AUTH_BYPASS = "1";
    setNodeEnv("development");
    const { isDevAuthBypass, devSession } = await import("./dev-auth");
    expect(isDevAuthBypass()).toBe(true);
    expect(devSession().userId).toBeTruthy();
  });
});
