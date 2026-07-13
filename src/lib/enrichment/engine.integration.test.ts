import { describe, expect, it, vi } from "vitest";

import { getSettings } from "./config";
import { buildFieldValue } from "./confidence";
import { WaterfallOrchestrator } from "./orchestrator";
import { gateEmail } from "./providers/emailGate";
import { ProviderRegistry } from "./providers/base";
import { OwnedScrapeAdapter } from "./providers/ownedScrape";
import { MockLakeB2BAdapter } from "./providers/lakeb2bMock";
import { MasterDBWriter, type MasterStore } from "./writeback";
import { JobStatus, makeContact, Tier } from "./types";

const settings = getSettings();

/**
 * Owned-only end-to-end: a realistic scrape (faked) flows through the real
 * OwnedScrapeAdapter + extract mapping, the real email gate, the real
 * orchestrator, and the real master build-up - proving the engine produces a
 * populated, scored, LinkedIn-keyed record with signal inputs and ZERO paid
 * cost, i.e. the one-OpenRouter-key path. No network, no DB.
 */
describe("owned-only enrichment end-to-end (one OpenRouter key)", () => {
  function ownedRegistry() {
    const webExtract = vi.fn(async () => ({
      success: true,
      url: "https://acme.com",
      source: "fetch" as const,
      data: {
        title: "Acme",
        description: "B2B SaaS",
        content: "Jane Doe leads engineering. jane@acme.com",
        contactInfo: { emails: ["jane@acme.com"], phones: [] },
      },
      extractionTime: 4,
    }));
    const resolveLinkedIn = vi.fn(
      async () => "https://www.linkedin.com/in/jane-doe",
    );
    // Faked profile fetch so the LinkedIn URL is a confirmed (verified) value
    // and no real network call happens in the test.
    const scrapeLinkedIn = vi.fn(async () => ({
      profile: { username: "jane-doe", name: "Jane Doe", headline: "VP Eng" },
      posts: [{ text: "We just closed Series B" }],
    }));
    // The LLM extraction (faked): the only "OpenRouter" call in the chain.
    const extract = vi.fn(async () => ({
      fields: {
        email: buildFieldValue({
          value: "jane@acme.com",
          provider: "owned_scrape",
          settings,
          verified: false,
        }),
        title: buildFieldValue({
          value: "VP Engineering",
          provider: "owned_scrape",
          settings,
        }),
      },
      firmographics: {
        company_name: "Acme",
        funding_stage: "Series B",
        recent_posts: ["We just closed Series B", "Hiring engineers"],
      },
    }));
    const reg = new ProviderRegistry(settings);
    reg.register(
      new OwnedScrapeAdapter({
        webExtract,
        resolveLinkedIn,
        scrapeLinkedIn,
        extract,
      }),
    );
    return { reg, webExtract, resolveLinkedIn, scrapeLinkedIn, extract };
  }

  it("scrapes -> extracts -> gates -> resolves LinkedIn -> accepts at $0 with signal inputs", async () => {
    const { reg } = ownedRegistry();
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      // Real owned gate with MX forced present (no DNS in tests).
      verifyEmail: (email) => gateEmail(email, { mxCheck: async () => true }),
    });

    const contact = makeContact({
      contactId: "11111111-1111-1111-1111-111111111111",
      fullName: "Jane Doe",
      domain: "acme.com",
      company: "Acme",
    });
    const result = await orch.run(contact, {
      requiredFields: ["email", "title", "linkedin"],
    });

    // Owned-only: zero paid spend, resolved at the owned scrape tier.
    expect(result.totalCostUsd).toBe(0);
    expect(result.status).toBe(JobStatus.Accepted);
    expect(result.resolvedTier).toBe(Tier.T1Lakestream);

    // No paid provider was ever attempted.
    const providersCalled = result.tiersAttempted.flatMap(
      (a) => a.providersCalled,
    );
    expect(providersCalled).toEqual(["owned_scrape"]);

    // LinkedIn URL (the join key) resolved; email verified by the owned gate.
    expect(result.fields.linkedin.value).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
    expect(result.fields.email.verified).toBe(true);
    expect(result.fields.title.value).toBe("VP Engineering");

    // Signal inputs are present for downstream scoring.
    expect(result.firmographics.funding_stage).toBe("Series B");
    expect(result.firmographics.recent_posts).toBeDefined();
  });

  it("builds up the owned master DB from the accepted record", async () => {
    const { reg } = ownedRegistry();
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: (email) => gateEmail(email, { mxCheck: async () => true }),
    });
    const contact = makeContact({
      contactId: "22222222-2222-2222-2222-222222222222",
      fullName: "Jane Doe",
      domain: "acme.com",
      company: "Acme",
    });
    await orch.run(contact, { requiredFields: ["email", "title", "linkedin"] });

    const upserts: Array<Record<string, unknown>> = [];
    const store: MasterStore = {
      findContact: async () => null,
      upsertContact: async (row) => {
        upserts.push(row);
        return { id: "m-1" };
      },
      logWriteback: async () => undefined,
    };
    const wb = await new MasterDBWriter(store).writeBack(contact);
    expect(wb).not.toBeNull();
    // Only verified / high-trust fields build up the owned master: the
    // gate-verified email and the profile-confirmed LinkedIn URL. The scraped
    // (unverified) title is intentionally withheld until a verified source
    // (e.g. LakeB2B) confirms it.
    expect(wb?.fieldsWritten).toEqual(
      expect.arrayContaining(["email", "linkedin"]),
    );
    expect(wb?.fieldsWritten).not.toContain("title");
    expect(upserts[0].email).toBe("jane@acme.com");
    expect(upserts[0].linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe");
  });
});

/**
 * The pinned LakeB2B primary (mock) runs AHEAD of the configurable priority
 * list. This proves the "LakeB2B first" rule from spec §5 is observable through
 * the real orchestrator once the adapter is registered.
 */
describe("LakeB2B pinned primary (mock adapter)", () => {
  it("runs lakeb2b first and fills fields from its record", async () => {
    const reg = new ProviderRegistry(settings);
    reg.register(new MockLakeB2BAdapter({ enabled: true }));
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: (email) => gateEmail(email, { mxCheck: async () => true }),
    });
    const contact = makeContact({
      contactId: "33333333-3333-3333-3333-333333333333",
      fullName: "Jane Doe",
      domain: "acme.com",
      company: "Acme",
    });
    const result = await orch.run(contact, {
      requiredFields: ["email", "title", "seniority"],
    });

    const providersCalled = result.tiersAttempted.flatMap(
      (a) => a.providersCalled,
    );
    expect(providersCalled).toEqual(["lakeb2b"]);
    expect(result.tiersAttempted[0].tier).toBe(Tier.T0Master);
    expect(result.fields.email.value).toBe("jane.doe@acme.com");
    expect(result.fields.title.value).toBeTruthy();
    expect(result.fields.seniority.value).toBeTruthy();
    expect(result.totalCostUsd).toBe(0);
  });

  it("is skipped entirely when the mock flag is off", async () => {
    const reg = new ProviderRegistry(settings);
    reg.register(new MockLakeB2BAdapter({ enabled: false }));
    const orch = new WaterfallOrchestrator({ registry: reg, settings });
    const contact = makeContact({
      contactId: "44444444-4444-4444-4444-444444444444",
      fullName: "Jane Doe",
      domain: "acme.com",
      company: "Acme",
    });
    const result = await orch.run(contact, {
      requiredFields: ["email", "title"],
    });
    const providersCalled = result.tiersAttempted.flatMap(
      (a) => a.providersCalled,
    );
    expect(providersCalled).not.toContain("lakeb2b");
    expect(result.status).toBe(JobStatus.Exhausted);
  });
});
