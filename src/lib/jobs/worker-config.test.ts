import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Worker-side half of GET /api/internal/worker-config (see the route's own
 * tests for the server side). Covers: only allowlisted keys are ever written
 * into process.env, and a fetch failure leaves whatever was applied by the
 * previous successful poll untouched ("last-good bundle").
 */

vi.mock("@/lib/jobs/internal-auth", () => ({
  getAppBaseUrl: () => "http://app.internal:3000",
  workerHeaders: () => ({ "x-worker-secret": "test-secret" }),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("applyWorkerConfig", () => {
  it("only writes allowlisted keys into process.env", async () => {
    const { applyWorkerConfig } = await import("./worker-config");
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DATABASE_URL;
    applyWorkerConfig({
      OPENROUTER_API_KEY: "or-key",
      DATABASE_URL: "postgres://should-not-be-set-by-this",
      SOME_UNKNOWN_VAR: "nope",
    });
    expect(process.env.OPENROUTER_API_KEY).toBe("or-key");
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.SOME_UNKNOWN_VAR).toBeUndefined();
  });

  it("ignores non-string values", async () => {
    const { applyWorkerConfig } = await import("./worker-config");
    delete process.env.PDL_MIN_LIKELIHOOD;
    applyWorkerConfig({ PDL_MIN_LIKELIHOOD: 0.5 as unknown as string });
    expect(process.env.PDL_MIN_LIKELIHOOD).toBeUndefined();
  });
});

describe("refreshWorkerConfig", () => {
  it("applies the fetched allowlisted config on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ config: { OPENROUTER_API_KEY: "fresh-key" } }),
      }),
    );
    const { refreshWorkerConfig } = await import("./worker-config");
    delete process.env.OPENROUTER_API_KEY;
    await refreshWorkerConfig();
    expect(process.env.OPENROUTER_API_KEY).toBe("fresh-key");
    expect(fetch).toHaveBeenCalledWith(
      "http://app.internal:3000/api/internal/worker-config",
      expect.objectContaining({
        headers: { "x-worker-secret": "test-secret" },
      }),
    );
  });

  it("keeps the last-good bundle when the fetch response is not ok", async () => {
    process.env.OPENROUTER_API_KEY = "last-good-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const { refreshWorkerConfig } = await import("./worker-config");
    await refreshWorkerConfig();
    expect(process.env.OPENROUTER_API_KEY).toBe("last-good-key");
  });

  it("keeps the last-good bundle and does not throw when fetch itself rejects", async () => {
    process.env.OPENROUTER_API_KEY = "last-good-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const { refreshWorkerConfig } = await import("./worker-config");
    await expect(refreshWorkerConfig()).resolves.toBeUndefined();
    expect(process.env.OPENROUTER_API_KEY).toBe("last-good-key");
  });
});
