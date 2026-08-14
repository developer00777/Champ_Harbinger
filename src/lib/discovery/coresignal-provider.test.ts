import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/enrichment/providers/keys", () => ({
  resolveProviderKey: vi.fn(
    async (_keyName: string, envValue?: string) => envValue ?? null,
  ),
}));

vi.mock("@/lib/lakeb2b/verifier", () => ({
  // Identity pass-through so this test stays about the provider, not the LLM
  // verification step (already covered by byok-discovery.test.ts).
  verifyCompanies: vi.fn(async (companies: unknown[]) =>
    companies.map((c) => ({ ...(c as object), passes: true, reason: "ok" })),
  ),
  verifyPeople: vi.fn(async (people: unknown[]) =>
    people.map((p) => ({ ...(p as object), passes: true, reason: "ok" })),
  ),
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

describe("hasCoresignalKey", () => {
  it("false when CORESIGNAL_API_KEY is unset", async () => {
    delete process.env.CORESIGNAL_API_KEY;
    const { hasCoresignalKey } = await import("./coresignal-provider");
    expect(await hasCoresignalKey()).toBe(false);
  });

  it("true when CORESIGNAL_API_KEY is set", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    const { hasCoresignalKey } = await import("./coresignal-provider");
    expect(await hasCoresignalKey()).toBe(true);
  });
});

describe("makeCoresignalProvider", () => {
  it("discoverCompanies posts entity=company and maps records", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 1,
            company_name: "Acme Inc",
            website: "https://acme.com",
            industry: "Software",
            employees_count: 500,
            size_range: "201-500",
            hq_country: "United States",
            professional_network_url: "https://linkedin.com/company/acme",
          },
        ],
      }),
    );
    const { makeCoresignalProvider } = await import("./coresignal-provider");
    const provider = makeCoresignalProvider();
    expect(provider.name).toBe("coresignal");
    expect(await provider.usesMockData?.()).toBe(false);

    const companies = await provider.discoverCompanies(
      "B2B SaaS in the US",
      10,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.coresignal.com/cdapi/v2/agentic_search/fast",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "cs-key" }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.entity).toBe("company");
    expect(body.return_data).toBe(true);

    expect(companies).toHaveLength(1);
    expect(companies[0].name).toBe("Acme Inc");
    expect(companies[0].domain).toBe("acme.com");
    expect(companies[0].employee_count).toBe(500);
    expect(companies[0].passes).toBe(true);
  });

  it("discoverPeople posts entity=employee and maps records", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 2,
            full_name: "Jane Doe",
            active_experience_title: "VP Engineering",
            company_name: "Acme Inc",
            professional_network_url: "https://linkedin.com/in/jane-doe",
            location_full: "San Francisco, California, United States",
            location_country: "United States",
          },
        ],
      }),
    );
    const { makeCoresignalProvider } = await import("./coresignal-provider");
    const provider = makeCoresignalProvider("user_123");
    const people = await provider.discoverPeople("VPs of Engineering", 5);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.entity).toBe("employee");
    expect(body.limit).toBe(5);

    expect(people).toHaveLength(1);
    expect(people[0].full_name).toBe("Jane Doe");
    expect(people[0].title).toBe("VP Engineering");
    expect(people[0].company_name).toBe("Acme Inc");
  });

  it("clamps limit to 100 (fast mode's per-call max)", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    const { makeCoresignalProvider } = await import("./coresignal-provider");
    await makeCoresignalProvider().discoverCompanies("criteria", 500);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.limit).toBe(100);
  });

  it("degrades to [] without a key, never calling fetch", async () => {
    delete process.env.CORESIGNAL_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { makeCoresignalProvider } = await import("./coresignal-provider");
    const companies = await makeCoresignalProvider().discoverCompanies(
      "criteria",
      10,
    );
    expect(companies).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates an upstream error rather than silently swallowing it", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const { makeCoresignalProvider } = await import("./coresignal-provider");
    await expect(
      makeCoresignalProvider().discoverCompanies("criteria", 10),
    ).rejects.toThrow(/500/);
  });

  // The live test account is on exactly this plan shape: Agentic Search is a
  // paid add-on (402), ES DSL search is included, `collect` is credit-gated.
  it("falls back to ES DSL + collect when agentic search 402s", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("agentic_search")) return { ok: false, status: 402 };
      if (url.includes("search/es_dsl")) {
        return { ok: true, status: 200, json: async () => [77] };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 77,
          company_name: "Esdsl Corp",
          website: "https://esdsl.com",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { makeCoresignalProvider } = await import("./coresignal-provider");
    const companies = await makeCoresignalProvider().discoverCompanies(
      "software companies",
      5,
    );

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain("agentic_search/fast");
    expect(urls[1]).toContain("company_base/search/es_dsl");
    expect(urls[2]).toContain("company_base/collect/77");
    expect(companies).toHaveLength(1);
    expect(companies[0].name).toBe("Esdsl Corp");
  });

  it("degrades to [] when the plan has no credits on any data path", async () => {
    process.env.CORESIGNAL_API_KEY = "cs-key";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("search/es_dsl")) {
        return { ok: true, status: 200, json: async () => [77] };
      }
      return { ok: false, status: 402 }; // agentic + collect both gated
    });
    vi.stubGlobal("fetch", fetchMock);

    const { makeCoresignalProvider } = await import("./coresignal-provider");
    const companies = await makeCoresignalProvider().discoverCompanies(
      "software companies",
      5,
    );
    // No records, and crucially no throw — the composite provider's other
    // half still gets to return its results.
    expect(companies).toEqual([]);
  });
});
