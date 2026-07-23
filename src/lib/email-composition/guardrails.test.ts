import { describe, expect, it } from "vitest";

import {
  assertDraftOnly,
  BANNED_PHRASES,
  buildGenericFallbackEmail,
  checkEmailGuardrails,
  countWords,
  DEFAULT_BODY_WORD_LIMIT,
  extractKeyTerms,
  findBannedPhrases,
  hasLowFrictionAsk,
  isGrounded,
  resolveBodyText,
  stripBannedPhraseSentences,
  stripHtmlTags,
  type PrimaryHook,
} from "./guardrails";

const HOOK: PrimaryHook = {
  fact: "They just closed a $12M Series A led by Acme Ventures.",
  sourceUrl: "https://example.com/news",
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("stripHtmlTags", () => {
  it("converts paragraphs and breaks to plain text", () => {
    const html = "<p>Hello there.</p><p>Line one<br/>Line two</p>";
    const text = stripHtmlTags(html);
    expect(text).toContain("Hello there.");
    expect(text).toContain("Line one");
    expect(text).toContain("Line two");
    expect(text).not.toContain("<p>");
  });

  it("decodes common entities", () => {
    expect(stripHtmlTags("<p>Fish &amp; chips &gt; tacos</p>")).toContain(
      "Fish & chips > tacos",
    );
  });
});

describe("resolveBodyText", () => {
  it("prefers bodyText when present", () => {
    expect(
      resolveBodyText({ bodyHtml: "<p>html</p>", bodyText: "plain text" }),
    ).toBe("plain text");
  });

  it("falls back to stripped html when bodyText is missing/blank", () => {
    expect(resolveBodyText({ bodyHtml: "<p>hi</p>", bodyText: "" })).toBe("hi");
    expect(resolveBodyText({ bodyHtml: "<p>hi</p>" })).toBe("hi");
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("returns 0 for empty/whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });
});

describe("extractKeyTerms", () => {
  it("drops short words and stopwords, lowercases the rest", () => {
    const terms = extractKeyTerms("They just closed a $12M Series A round");
    expect(terms).toContain("closed");
    expect(terms).toContain("series");
    expect(terms).toContain("round");
    expect(terms).not.toContain("they");
    expect(terms).not.toContain("just");
    expect(terms).not.toContain("a");
  });
});

describe("isGrounded", () => {
  it("is vacuously true when no hook is supplied", () => {
    expect(isGrounded("anything at all", null)).toBe(true);
    expect(isGrounded("anything at all", undefined)).toBe(true);
  });

  it("is true when the body references a hook keyword", () => {
    const body = "Congrats on closing your Series A — must be a busy stretch.";
    expect(isGrounded(body, HOOK)).toBe(true);
  });

  it("is false when the body never references the hook", () => {
    const body = "Hi, wanted to tell you about our product for sales teams.";
    expect(isGrounded(body, HOOK)).toBe(false);
  });
});

describe("findBannedPhrases / stripBannedPhraseSentences", () => {
  it("finds banned phrases case-insensitively", () => {
    const found = findBannedPhrases(
      "Hope You're Doing Well! Wanted to share something.",
    );
    expect(found).toContain("hope you're doing well");
  });

  it("does not false-positive on unrelated text", () => {
    expect(findBannedPhrases("Worth a quick reply?")).toHaveLength(0);
  });

  it("every banned phrase in the list is individually detected", () => {
    for (const phrase of BANNED_PHRASES) {
      expect(findBannedPhrases(`${phrase}. Here's the pitch.`)).toContain(
        phrase,
      );
    }
  });

  it("strips only the offending sentence, keeps the rest", () => {
    const text =
      "Hope this finds you well. We help teams close deals faster. Worth a quick reply?";
    const stripped = stripBannedPhraseSentences(text);
    expect(stripped).not.toMatch(/hope this finds you well/i);
    expect(stripped).toContain("We help teams close deals faster.");
    expect(stripped).toContain("Worth a quick reply?");
  });
});

describe("hasLowFrictionAsk", () => {
  it("is true when the final sentence ends in a question mark", () => {
    expect(
      hasLowFrictionAsk("Some context. More context. Worth a quick reply?"),
    ).toBe(true);
  });

  it("is true when the second-to-last sentence is the question", () => {
    expect(
      hasLowFrictionAsk("Open to a 15-min call? Let me know either way."),
    ).toBe(true);
  });

  it("is false when there's no question at the end", () => {
    expect(hasLowFrictionAsk("Just letting you know we exist. Thanks.")).toBe(
      false,
    );
  });

  it("is false for empty text", () => {
    expect(hasLowFrictionAsk("")).toBe(false);
  });
});

describe("checkEmailGuardrails", () => {
  const okEmail = {
    bodyHtml:
      "<p>Congrats on closing your Series A — big milestone.</p><p>We help teams like yours ramp outbound fast. Worth a quick reply?</p>",
  };

  it("passes a clean, grounded, short draft with a CTA", () => {
    const result = checkEmailGuardrails(okEmail, { hook: HOOK });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes gracefully with no hook supplied at all", () => {
    const result = checkEmailGuardrails(okEmail);
    expect(result.ok).toBe(true);
  });

  it("flags WORD_LIMIT when the body is too long", () => {
    const longBody = Array(DEFAULT_BODY_WORD_LIMIT + 20)
      .fill("word")
      .join(" ")
      .concat(" Worth a quick reply?");
    const result = checkEmailGuardrails({ bodyHtml: `<p>${longBody}</p>` });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("WORD_LIMIT");
  });

  it("respects a custom wordLimit", () => {
    const result = checkEmailGuardrails(
      { bodyHtml: "<p>One two three four five. Worth a reply?</p>" },
      { wordLimit: 3 },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("WORD_LIMIT");
  });

  it("flags BANNED_PHRASE when fake-familiarity filler is present", () => {
    const result = checkEmailGuardrails({
      bodyHtml: "<p>Hope this finds you well. Worth a quick reply?</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("BANNED_PHRASE");
  });

  it("flags UNGROUNDED when a hook was given but never used", () => {
    const result = checkEmailGuardrails(
      { bodyHtml: "<p>We help sales teams close more deals. Interested?</p>" },
      { hook: HOOK },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("UNGROUNDED");
  });

  it("flags NO_LOW_FRICTION_ASK when there's no closing question", () => {
    const result = checkEmailGuardrails({
      bodyHtml: "<p>We help sales teams close more deals. Thanks.</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain(
      "NO_LOW_FRICTION_ASK",
    );
  });

  it("can report multiple simultaneous violations", () => {
    const result = checkEmailGuardrails(
      {
        bodyHtml:
          "<p>Hope this finds you well. We help sales teams close more deals. Thanks.</p>",
      },
      { hook: HOOK },
    );
    expect(result.ok).toBe(false);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("BANNED_PHRASE");
    expect(codes).toContain("UNGROUNDED");
    expect(codes).toContain("NO_LOW_FRICTION_ASK");
  });
});

describe("buildGenericFallbackEmail", () => {
  it("produces a draft that itself clears the guardrail checks", () => {
    const email = buildGenericFallbackEmail({
      recipientName: "Jamie Rivera",
      recipientTitle: "VP of Sales",
      companyName: "Acme Corp",
      senderName: "Alex",
      senderCompany: "Harbinger",
      offeringSummary: null,
    });
    const result = checkEmailGuardrails(email);
    expect(result.ok).toBe(true);
    expect(email.aiReasoning).toMatch(/GENERIC-SAFE FALLBACK/);
  });

  it("does not invent any facts when given minimal input", () => {
    const email = buildGenericFallbackEmail({});
    expect(email.bodyText).toBeTruthy();
    const result = checkEmailGuardrails(email);
    expect(result.ok).toBe(true);
  });
});

describe("assertDraftOnly", () => {
  it("does not throw for status 'draft' or undefined/null", () => {
    expect(() => assertDraftOnly({ status: "draft" })).not.toThrow();
    expect(() => assertDraftOnly({})).not.toThrow();
    expect(() => assertDraftOnly({ status: null })).not.toThrow();
  });

  it("throws for any non-draft status", () => {
    expect(() => assertDraftOnly({ status: "sent" })).toThrow(
      /may only ever write status "draft"/,
    );
    expect(() => assertDraftOnly({ status: "approved" })).toThrow();
  });
});
