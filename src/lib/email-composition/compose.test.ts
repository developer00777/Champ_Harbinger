import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.fn();

vi.mock("@/lib/ai/generate", () => ({
  generateObjectLimited: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@/lib/ai/provider", () => ({
  getModelSync: () => "mock-model",
}));

vi.mock("@/lib/ai/models", () => ({
  Models: { personalization: () => "mock-model-id" },
}));

import { composeEmail, mapConcurrent } from "./compose";
import type { ComposeInput } from "./compose";

const BASE_INPUT: ComposeInput = {
  contact: {
    name: "Jamie Rivera",
    title: "VP of Sales",
    email: "jamie@acme.com",
    enrichmentData: null,
  },
  company: {
    name: "Acme Corp",
    domain: "acme.com",
    industry: "SaaS",
    enrichmentData: null,
  },
  step: {
    stepNumber: 1,
    totalSteps: 3,
    condition: "initial",
    isFinal: false,
  },
  campaign: {
    name: "Q3 outbound",
    icp: null,
    offering: null,
    positioning: null,
  },
  senderProfile: {
    name: "Alex",
    title: "AE",
    company: "Harbinger",
    signature: "Alex",
  },
};

const CLEAN_EMAIL = {
  subject: "Congrats on the raise",
  bodyHtml:
    "<p>Congrats on closing your Series A — big milestone.</p><p>We help teams like yours ramp outbound fast. Worth a quick reply?</p>",
  bodyText:
    "Congrats on closing your Series A — big milestone.\n\nWe help teams like yours ramp outbound fast. Worth a quick reply?",
  aiReasoning: "Used the funding announcement as the hook.",
};

const UNGROUNDED_EMAIL = {
  subject: "Quick question",
  bodyHtml:
    "<p>We help sales teams close more deals with better outbound.</p><p>Thanks.</p>",
  bodyText:
    "We help sales teams close more deals with better outbound.\n\nThanks.",
  aiReasoning: "Generic role-based opener.",
};

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("composeEmail", () => {
  it("returns ok with a clean draft on the first attempt, no regeneration", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: CLEAN_EMAIL });

    const result = await composeEmail(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.subject).toBe(CLEAN_EMAIL.subject);
    expect(result.guardrails.regenerated).toBe(false);
    expect(result.guardrails.usedFallback).toBe(false);
    expect(result.guardrails.violations).toHaveLength(0);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("works gracefully with no hook (hook is optional)", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: CLEAN_EMAIL });

    const result = await composeEmail({
      ...BASE_INPUT,
      personalizationHook: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guardrails.violations).toHaveLength(0);
  });

  it("regenerates once when the first draft fails guardrails, then succeeds", async () => {
    generateObjectMock
      .mockResolvedValueOnce({
        object: {
          ...UNGROUNDED_EMAIL,
        },
      })
      .mockResolvedValueOnce({ object: CLEAN_EMAIL });

    const result = await composeEmail({
      ...BASE_INPUT,
      personalizationHook: {
        fact: "They just closed a $12M Series A led by Acme Ventures.",
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(result.guardrails.regenerated).toBe(true);
    expect(result.guardrails.usedFallback).toBe(false);
    // second call's prompt should include corrective feedback
    const secondCallArgs = generateObjectMock.mock.calls[1][0];
    expect(secondCallArgs.prompt).toMatch(/REGENERATE/);
  });

  it("falls back to the generic-safe template when both attempts fail guardrails", async () => {
    generateObjectMock
      .mockResolvedValueOnce({ object: UNGROUNDED_EMAIL })
      .mockResolvedValueOnce({ object: UNGROUNDED_EMAIL });

    const result = await composeEmail({
      ...BASE_INPUT,
      personalizationHook: {
        fact: "They just closed a $12M Series A led by Acme Ventures.",
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(result.guardrails.usedFallback).toBe(true);
    expect(result.email.aiReasoning).toMatch(/GENERIC-SAFE FALLBACK/);
  });

  it("attempts a personId hook lookup and degrades gracefully when the module is missing", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: CLEAN_EMAIL });

    const result = await composeEmail({
      ...BASE_INPUT,
      personId: "11111111-1111-1111-1111-111111111111",
    });

    // knowledge-graph/retrieval doesn't exist on disk yet (built by a
    // sibling agent) — composition must still succeed.
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when generation throws", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("provider exploded"));

    const result = await composeEmail(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/provider exploded/);
  });
});

describe("mapConcurrent", () => {
  it("still works (unchanged helper) — bounded concurrency preserves order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapConcurrent(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});
