import { describe, it, expect, beforeEach, vi } from "vitest";

describe("getModel", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.HARBINGER_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
  });

  it("returns a LanguageModel for the default when no id given", async () => {
    const { getModel } = await import("./provider");
    const m = getModel();
    expect(m).toBeDefined();
    // Vercel AI SDK models expose a modelId or specificationVersion;
    // we just assert it's truthy here, full integration is verified later.
  });

  it("returns a LanguageModel for an explicit id", async () => {
    const { getModel } = await import("./provider");
    const m = getModel("openai/gpt-4o-mini");
    expect(m).toBeDefined();
  });

  it("importing ./env does not throw when OPENROUTER_API_KEY is missing (lazy validation)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("throws on first actual read of aiEnv when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { aiEnv } = await import("./env");
    expect(() => aiEnv.OPENROUTER_API_KEY).toThrow(/OPENROUTER_API_KEY/);
  });

  it("getModel rejects when OPENROUTER_API_KEY is missing (deferred to actual use)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { getModel } = await import("./provider");
    await expect(getModel()).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
