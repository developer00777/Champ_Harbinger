import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider selection matrix for getDiscoveryProvider(). Coresignal slots in
 * as a plug-and-play stand-in for LakeB2B (see coresignal-provider.ts): it
 * only gets picked when there's no real LakeB2B key, and steps back out the
 * moment one is configured — no code change required, just add the LakeB2B
 * key.
 */

vi.mock("@/lib/lakeb2b/client", () => ({
  hasLakeB2BKey: vi.fn(),
}));
vi.mock("@/lib/search/searxng-client", () => ({
  isSearxConfigured: vi.fn(),
}));
vi.mock("./coresignal-provider", () => ({
  hasCoresignalKey: vi.fn(),
  makeCoresignalProvider: vi.fn(() => ({
    name: "coresignal",
    usesMockData: async () => false,
    discoverCompanies: async () => [],
    discoverPeople: async () => [],
  })),
}));
vi.mock("./lakeb2b-provider", () => ({
  makeLakeB2BProvider: vi.fn(() => ({
    name: "lakeb2b",
    usesMockData: async () => false,
    discoverCompanies: async () => [],
    discoverPeople: async () => [],
  })),
}));
vi.mock("./public-web-provider", () => ({
  makePublicWebProvider: vi.fn(() => ({
    name: "public-web",
    usesMockData: async () => false,
    discoverCompanies: async () => [],
    discoverPeople: async () => [],
  })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(opts: {
  lakeb2b: boolean;
  searx: boolean;
  coresignal: boolean;
}) {
  const { hasLakeB2BKey } = await import("@/lib/lakeb2b/client");
  const { isSearxConfigured } = await import("@/lib/search/searxng-client");
  const { hasCoresignalKey } = await import("./coresignal-provider");
  vi.mocked(hasLakeB2BKey).mockResolvedValue(opts.lakeb2b);
  vi.mocked(isSearxConfigured).mockReturnValue(opts.searx);
  vi.mocked(hasCoresignalKey).mockResolvedValue(opts.coresignal);
  return import("./index");
}

describe("getDiscoveryProvider selection order", () => {
  it("LakeB2B + SearXNG -> composite(lakeb2b primary)", async () => {
    const { getDiscoveryProvider } = await setup({
      lakeb2b: true,
      searx: true,
      coresignal: true, // present but irrelevant — LakeB2B wins outright
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("lakeb2b");
  });

  it("LakeB2B only -> lakeb2b", async () => {
    const { getDiscoveryProvider } = await setup({
      lakeb2b: true,
      searx: false,
      coresignal: false,
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("lakeb2b");
  });

  it("Coresignal + SearXNG, no LakeB2B -> composite(coresignal primary)", async () => {
    const { getDiscoveryProvider } = await setup({
      lakeb2b: false,
      searx: true,
      coresignal: true,
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("coresignal");
  });

  it("Coresignal only, no LakeB2B, no SearXNG -> coresignal", async () => {
    const { getDiscoveryProvider } = await setup({
      lakeb2b: false,
      searx: false,
      coresignal: true,
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("coresignal");
  });

  it("SearXNG only, no keys -> public-web", async () => {
    const { getDiscoveryProvider } = await setup({
      lakeb2b: false,
      searx: true,
      coresignal: false,
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("public-web");
  });

  it("nothing configured -> mock LakeB2B fallback, loudly warned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getDiscoveryProvider } = await setup({
      lakeb2b: false,
      searx: false,
      coresignal: false,
    });
    const provider = await getDiscoveryProvider();
    expect(provider.name).toBe("lakeb2b");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MOCK data"));
  });
});
