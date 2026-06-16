import { describe, expect, it } from "vitest";

import { getSettings } from "./config";
import { buildFieldValue } from "./confidence";
import { WaterfallOrchestrator } from "./orchestrator";
import { ProviderRegistry, type ProviderAdapter } from "./providers/base";
import {
  emptyResult,
  EmailVerdict,
  JobStatus,
  makeContact,
  Tier,
  type Contact,
  type EmailVerification,
  type ProviderResult,
} from "./types";

const settings = getSettings();

/** A fake adapter that returns canned fields at a given tier/name. */
class FakeAdapter implements ProviderAdapter {
  constructor(
    readonly tier: Tier,
    readonly name: string,
    readonly costPerCall: number,
    private readonly fields: Record<string, unknown>,
    private readonly opts: {
      verifiedEmail?: boolean;
      fail?: boolean;
      firmographics?: Record<string, unknown>;
    } = {},
  ) {}
  canSupply(): boolean {
    return true;
  }
  isEnabled(): boolean {
    return true;
  }
  async fetch(_contact: Contact): Promise<ProviderResult> {
    if (this.opts.fail) {
      return emptyResult(this.name, this.tier, "forced_failure");
    }
    const out: Record<string, ReturnType<typeof buildFieldValue>> = {};
    for (const [k, v] of Object.entries(this.fields)) {
      out[k] = buildFieldValue({
        value: v,
        provider: this.name,
        settings,
        verified: k === "email" ? Boolean(this.opts.verifiedEmail) : true,
      });
    }
    return {
      provider: this.name,
      tier: this.tier,
      success: true,
      fields: out,
      firmographics: this.opts.firmographics ?? {},
      emailVerification: null,
      costUsd: this.costPerCall,
      latencyMs: 1,
      httpStatus: 200,
      error: null,
      requestIdentifiers: {},
    };
  }
}

function registryWith(adapters: ProviderAdapter[]): ProviderRegistry {
  const reg = new ProviderRegistry(settings);
  for (const a of adapters) reg.register(a);
  return reg;
}

const deliverable: () => Promise<EmailVerification> = async () => ({
  email: "x",
  verdict: EmailVerdict.Deliverable,
  catchAll: false,
  score: 1,
  provider: "owned_email_gate",
});

describe("WaterfallOrchestrator", () => {
  it("fills all required fields from owned_scrape and accepts at $0", async () => {
    const reg = registryWith([
      new FakeAdapter(
        Tier.T1Lakestream,
        "owned_scrape",
        0,
        { email: "a@acme.com", title: "VP", company: "Acme" },
        { verifiedEmail: true },
      ),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: deliverable,
    });
    const result = await orch.run(makeContact({ domain: "acme.com" }));
    expect(result.status).toBe(JobStatus.Accepted);
    expect(result.resolvedTier).toBe(Tier.T1Lakestream);
    expect(result.totalCostUsd).toBe(0);
  });

  it("escalates past an empty owned_scrape to a paid provider", async () => {
    const reg = registryWith([
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, {}, { fail: true }),
      new FakeAdapter(
        Tier.T2Person,
        "proxycurl",
        0.03,
        { email: "a@acme.com", title: "VP", company: "Acme" },
        { verifiedEmail: true },
      ),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: deliverable,
    });
    const result = await orch.run(makeContact({ domain: "acme.com" }));
    expect(result.status).toBe(JobStatus.Accepted);
    expect(result.resolvedTier).toBe(Tier.T2Person);
    expect(result.totalCostUsd).toBeGreaterThan(0);
  });

  it("escalates through the priority list by rank for missing fields", async () => {
    // owned_scrape supplies title only; proxycurl supplies email + company.
    const reg = registryWith([
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, { title: "VP" }),
      new FakeAdapter(
        Tier.T2Person,
        "proxycurl",
        0.03,
        { email: "a@acme.com", company: "Acme" },
        { verifiedEmail: true },
      ),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: deliverable,
    });
    const result = await orch.run(makeContact({ domain: "acme.com" }));
    expect(result.status).toBe(JobStatus.Accepted);
    expect(result.resolvedTier).toBe(Tier.T2Person);
    const ownedAttempt = result.tiersAttempted.find(
      (a) => a.tier === Tier.T1Lakestream,
    );
    expect(ownedAttempt?.providersCalled).toContain("owned_scrape");
  });

  it("stops on the per-job budget before spending more", async () => {
    const reg = registryWith([
      new FakeAdapter(Tier.T2Person, "proxycurl", 0.5, { title: "VP" }),
      new FakeAdapter(
        Tier.T3Heavy,
        "apollo",
        0.5,
        { email: "a@acme.com", company: "Acme" },
        { verifiedEmail: true },
      ),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: deliverable,
    });
    const result = await orch.run(makeContact({ domain: "acme.com" }), {
      budgetUsd: 0.4,
    });
    expect(result.status).toBe(JobStatus.Exhausted);
    expect(result.totalCostUsd).toBeLessThanOrEqual(0.4);
    expect(result.notes.some((n) => n.toLowerCase().includes("budget"))).toBe(
      true,
    );
  });

  it("discards an undeliverable seed email and escalates", async () => {
    const undeliverable: () => Promise<EmailVerification> = async () => ({
      email: "bad@acme.com",
      verdict: EmailVerdict.Undeliverable,
      catchAll: false,
      score: 0,
      provider: "owned_email_gate",
    });
    const reg = registryWith([
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, {}, { fail: true }),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: undeliverable,
    });
    const contact = makeContact({ domain: "acme.com" });
    contact.fields.email = buildFieldValue({
      value: "bad@acme.com",
      provider: "caller_input",
      settings,
    });
    const result = await orch.run(contact);
    expect(result.fields.email).toBeUndefined();
    expect(result.notes.some((n) => n.includes("undeliverable"))).toBe(true);
  });

  it("respects maxTier and does not escalate beyond it", async () => {
    const reg = registryWith([
      new FakeAdapter(Tier.T1Lakestream, "owned_scrape", 0, { title: "VP" }),
      new FakeAdapter(
        Tier.T2Person,
        "proxycurl",
        0.03,
        { email: "a@acme.com", title: "VP", company: "Acme" },
        { verifiedEmail: true },
      ),
    ]);
    const orch = new WaterfallOrchestrator({
      registry: reg,
      settings,
      verifyEmail: deliverable,
    });
    const result = await orch.run(makeContact({ domain: "acme.com" }), {
      maxTier: Tier.T1Lakestream,
    });
    expect(result.status).toBe(JobStatus.Exhausted);
    expect(result.totalCostUsd).toBe(0);
  });
});
