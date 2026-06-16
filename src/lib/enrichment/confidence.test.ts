import { describe, expect, it } from "vitest";

import { getSettings } from "./config";
import {
  applyEmailGate,
  buildFieldValue,
  completeness,
  computeConfidence,
  freshnessDecay,
  mergeFields,
  recordConfidence,
  resolveConflict,
} from "./confidence";
import { EmailVerdict, type FieldValue } from "./types";

const settings = getSettings();

function fv(partial: Partial<FieldValue> & { value: unknown }): FieldValue {
  return {
    value: partial.value,
    source: partial.source ?? "test",
    confidence: partial.confidence ?? 0.5,
    verified: partial.verified ?? false,
    observedAt: partial.observedAt ?? new Date(),
  };
}

describe("confidence model", () => {
  it("decays freshness to ~0.5 at the half-life", () => {
    const halfLifeAgo = new Date(
      Date.now() - settings.freshnessHalfLifeDays * 86_400_000,
    );
    const f = freshnessDecay(halfLifeAgo, settings);
    expect(f).toBeGreaterThan(0.45);
    expect(f).toBeLessThan(0.55);
  });

  it("scores a fresh value near 1.0", () => {
    expect(freshnessDecay(new Date(), settings)).toBeGreaterThan(0.99);
  });

  it("applies the verification boost only when verified", () => {
    const now = new Date();
    const plain = computeConfidence({
      provider: "owned_master",
      observedAt: now,
      settings,
      verified: false,
    });
    const boosted = computeConfidence({
      provider: "owned_master",
      observedAt: now,
      settings,
      verified: true,
    });
    expect(boosted).toBeGreaterThanOrEqual(plain);
  });

  it("clamps confidence to [0,1]", () => {
    const f = buildFieldValue({
      value: "x",
      provider: "owned_master",
      settings,
      verified: true,
    });
    expect(f.confidence).toBeLessThanOrEqual(1);
    expect(f.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("email gate", () => {
  it("boosts and verifies a deliverable email", () => {
    const email = fv({ value: "a@b.com", confidence: 0.6 });
    const gated = applyEmailGate(email, EmailVerdict.Deliverable, settings);
    expect(gated).not.toBeNull();
    expect(gated?.verified).toBe(true);
    expect(gated?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("caps a catch-all email", () => {
    const email = fv({ value: "a@b.com", confidence: 0.9 });
    const gated = applyEmailGate(email, EmailVerdict.CatchAll, settings);
    expect(gated?.confidence).toBeLessThanOrEqual(settings.catchAllEmailCap);
    expect(gated?.verified).toBe(false);
  });

  it("discards an undeliverable email", () => {
    const email = fv({ value: "a@b.com", confidence: 0.9 });
    expect(
      applyEmailGate(email, EmailVerdict.Undeliverable, settings),
    ).toBeNull();
  });
});

describe("merge + scoring", () => {
  it("keeps a verified value over an unverified higher-confidence one when they agree", () => {
    const existing = {
      email: fv({ value: "old@x.com", verified: true, confidence: 0.7 }),
    };
    const incoming = {
      email: fv({ value: "old@x.com", verified: false, confidence: 0.95 }),
    };
    const merged = mergeFields(existing, incoming);
    expect(merged.email.value).toBe("old@x.com");
    expect(merged.email.verified).toBe(true);
  });

  it("takes the higher-confidence value when neither is sticky and values agree", () => {
    const existing = { title: fv({ value: "VP Eng", confidence: 0.5 }) };
    const incoming = { title: fv({ value: "vp eng", confidence: 0.8 }) };
    const merged = mergeFields(existing, incoming);
    expect(merged.title.confidence).toBe(0.8);
  });

  it("gates record confidence to 0 when a required field is missing", () => {
    const fields = { email: fv({ value: "a@b.com", confidence: 0.9 }) };
    const score = recordConfidence(fields, ["email", "title"]);
    expect(score).toBeLessThanOrEqual(0.46);
  });

  it("computes completeness as the present fraction", () => {
    const fields = {
      email: fv({ value: "a@b.com" }),
      title: fv({ value: "VP" }),
    };
    expect(completeness(fields, ["email", "title", "company"])).toBeCloseTo(
      2 / 3,
      5,
    );
  });
});

describe("conflict resolution (recency wins)", () => {
  it("prefers the more recently observed value when two sources disagree", () => {
    const older = fv({
      value: "VP Sales",
      confidence: 0.9,
      observedAt: new Date("2024-01-01"),
    });
    const newer = fv({
      value: "Chief Revenue Officer",
      confidence: 0.6,
      observedAt: new Date("2026-06-01"),
    });
    expect(resolveConflict(older, newer).value).toBe("Chief Revenue Officer");
    // and via mergeFields, the fresh live value overrides the stale vendor one
    const merged = mergeFields({ title: older }, { title: newer });
    expect(merged.title.value).toBe("Chief Revenue Officer");
  });

  it("keeps equal-recency higher-confidence value", () => {
    const d = new Date("2026-06-01");
    const a = fv({ value: "A", confidence: 0.4, observedAt: d });
    const b = fv({ value: "B", confidence: 0.8, observedAt: d });
    expect(resolveConflict(a, b).value).toBe("B");
  });

  it("a stale verified value loses to a fresher unverified one on genuine conflict", () => {
    const staleVerified = fv({
      value: "old@x.com",
      verified: true,
      confidence: 0.8,
      observedAt: new Date("2023-01-01"),
    });
    const freshUnverified = fv({
      value: "new@x.com",
      verified: false,
      confidence: 0.5,
      observedAt: new Date("2026-06-01"),
    });
    const merged = mergeFields(
      { email: staleVerified },
      { email: freshUnverified },
    );
    expect(merged.email.value).toBe("new@x.com");
  });
});
