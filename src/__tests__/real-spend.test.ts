import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchWithTimeout so we can control the OpenRouter credits response.
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { fetchOpenRouterCredits } from "@/lib/services/real-spend";

const mockFetch = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

describe("fetchOpenRouterCredits", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns usage + remaining from total_credits − total_usage", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { total_credits: 100, total_usage: 42.5 } }),
    });

    const result = await fetchOpenRouterCredits();
    expect(result).toEqual({ usage: 42.5, remaining: 57.5 });
  });

  it("returns null when the API key is unset", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await fetchOpenRouterCredits()).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null on a non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    expect(await fetchOpenRouterCredits()).toBeNull();
  });

  it("returns null when the request throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await fetchOpenRouterCredits()).toBeNull();
  });
});
