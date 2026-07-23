/**
 * Guardrails for AI-composed outreach emails (Port B — "The Writer").
 *
 * Pure, dependency-free functions that enforce the hard quality bars a
 * generated draft must clear before it is ever handed to a human reviewer:
 *
 *   1. Grounding    — if a verified `PrimaryHook` was supplied, the draft
 *                      must actually reference it.
 *   2. Word limit    — hard cap on body length.
 *   3. Banned phrases — no fake-familiarity filler ("hope this finds you
 *                      well", etc).
 *   4. Low-friction ask — the draft must close with a soft, low-commitment
 *                      CTA (cheap heuristic: ends on a question).
 *   5. Draft-only    — a runtime assertion (not just a TS type) that nothing
 *                      persisting an `email_drafts` row can smuggle through
 *                      a non-"draft" status.
 *
 * These are enforced programmatically because LLMs drift from prompt
 * instructions under load — see compose.ts for how a failing check triggers
 * one regeneration attempt and then a deterministic fallback template.
 */

/** The one verified fact a draft is allowed to personalize around. Mirrors
 * the shape returned by Port A's `getPersonContext().primaryHook`. */
export interface PrimaryHook {
  fact: string;
  sourceUrl?: string;
  capturedAt: string;
}

export const DEFAULT_BODY_WORD_LIMIT = 120;

/**
 * Case-insensitive, word-boundary-matched phrases that read as fake
 * familiarity / low-effort mail-merge filler. Kept as plain strings (not
 * pre-built regexes) so the list is easy to extend/review.
 */
export const BANNED_PHRASES: readonly string[] = [
  "hope you're doing well",
  "hope you are doing well",
  "hope this finds you well",
  "hope this email finds you well",
  "hope you're having a great week",
  "hope you are having a great week",
  "hope all is well",
  "just wanted to reach out",
  "i wanted to reach out",
  "just reaching out",
  "just checking in",
  "i hope you don't mind me reaching out",
  "trust this email finds you well",
  "i know you're busy",
  "i know how busy you are",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a case-insensitive, word-boundary regex for a banned phrase. */
function bannedPhraseRegex(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i");
}

/** Strips HTML tags down to plain text for word-counting / phrase-matching. */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Resolves the best plain-text representation of a composed email body. */
export function resolveBodyText(email: {
  bodyHtml: string;
  bodyText?: string | null;
}): string {
  if (email.bodyText && email.bodyText.trim().length > 0) {
    return email.bodyText.trim();
  }
  return stripHtmlTags(email.bodyHtml);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Splits plain text into rough sentences. Heuristic, not a real sentence
 * tokenizer — good enough for the CTA/banned-phrase checks below. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "your",
  "you",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "from",
  "into",
  "onto",
  "about",
  "just",
  "recently",
  "recent",
  "their",
  "they",
  "them",
  "our",
  "ours",
  "its",
  "it's",
]);

/**
 * Pulls the meaningful keywords out of a hook's `fact` string: lowercased
 * words of length >= 4 that aren't common stopwords. Used for the
 * substring/keyword-overlap grounding check — deliberately simple rather
 * than semantic, per the "hard, programmatic check" requirement.
 */
export function extractKeyTerms(fact: string): string[] {
  const words = fact
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const terms = words.filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return Array.from(new Set(terms));
}

/**
 * Checks whether the draft body actually references the supplied hook via
 * simple substring/keyword overlap. Returns true (vacuously grounded) when
 * no hook was supplied — grounding only applies when there is something to
 * ground on.
 */
export function isGrounded(
  bodyText: string,
  hook: PrimaryHook | null | undefined,
): boolean {
  if (!hook || !hook.fact.trim()) return true;
  const haystack = bodyText.toLowerCase();
  const terms = extractKeyTerms(hook.fact);
  if (terms.length === 0) {
    // Fact had no extractable keywords (e.g. very short) — fall back to a
    // whole-string substring check.
    return haystack.includes(hook.fact.toLowerCase().trim());
  }
  return terms.some((term) => haystack.includes(term));
}

/** Returns the banned phrases (lowercased, as authored in BANNED_PHRASES)
 * present in the given text. */
export function findBannedPhrases(text: string): string[] {
  return BANNED_PHRASES.filter((phrase) =>
    bannedPhraseRegex(phrase).test(text),
  );
}

/**
 * Removes any sentence containing a banned phrase. Used to salvage an
 * otherwise-good draft by stripping the offending filler line rather than
 * discarding the whole email. Operates on plain text; callers that also
 * need to clean bodyHtml should re-derive it (compose.ts regenerates
 * instead of patching HTML, since sentence-level HTML surgery is lossy).
 */
export function stripBannedPhraseSentences(text: string): string {
  const sentences = splitSentences(text);
  const kept = sentences.filter(
    (s) => !BANNED_PHRASES.some((phrase) => bannedPhraseRegex(phrase).test(s)),
  );
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Cheap heuristic gate for "ends on a low-friction ask": true if either of
 * the last two sentences ends with a question mark.
 *
 * Limits (documented per spec): this only checks punctuation, not intent —
 * "Are you still ignoring these emails?" would pass, and a genuinely
 * low-friction ask phrased as a statement ("Happy to send more info if
 * useful.") would fail. It's intentionally cheap; treat it as a floor, not
 * a substitute for human review.
 */
export function hasLowFrictionAsk(bodyText: string): boolean {
  const sentences = splitSentences(bodyText);
  if (sentences.length === 0) return false;
  const tail = sentences.slice(-2);
  return tail.some((s) => s.endsWith("?"));
}

export type GuardrailViolationCode =
  "WORD_LIMIT" | "BANNED_PHRASE" | "UNGROUNDED" | "NO_LOW_FRICTION_ASK";

export interface GuardrailViolation {
  code: GuardrailViolationCode;
  message: string;
}

export interface GuardrailCheckResult {
  ok: boolean;
  violations: GuardrailViolation[];
  wordCount: number;
  bodyText: string;
}

export interface GuardrailCheckOptions {
  hook?: PrimaryHook | null;
  wordLimit?: number;
}

/**
 * Runs all post-generation guardrail checks against a composed email and
 * returns a structured result. Does not mutate the input or throw — callers
 * decide what to do with violations (regenerate, strip, fall back).
 */
export function checkEmailGuardrails(
  email: { bodyHtml: string; bodyText?: string | null },
  options: GuardrailCheckOptions = {},
): GuardrailCheckResult {
  const bodyText = resolveBodyText(email);
  const wordLimit = options.wordLimit ?? DEFAULT_BODY_WORD_LIMIT;
  const wordCount = countWords(bodyText);
  const violations: GuardrailViolation[] = [];

  if (wordCount > wordLimit) {
    violations.push({
      code: "WORD_LIMIT",
      message: `Body is ${wordCount} words, exceeds the ${wordLimit}-word limit.`,
    });
  }

  const banned = findBannedPhrases(bodyText);
  if (banned.length > 0) {
    violations.push({
      code: "BANNED_PHRASE",
      message: `Contains banned fake-familiarity phrase(s): ${banned.join(", ")}.`,
    });
  }

  if (options.hook && !isGrounded(bodyText, options.hook)) {
    violations.push({
      code: "UNGROUNDED",
      message:
        "Draft does not reference the supplied primary hook — the LLM was given one verified fact and did not use it.",
    });
  }

  if (!hasLowFrictionAsk(bodyText)) {
    violations.push({
      code: "NO_LOW_FRICTION_ASK",
      message:
        "Draft does not end with a low-commitment question/CTA (last two sentences have no '?').",
    });
  }

  return { ok: violations.length === 0, violations, wordCount, bodyText };
}

/** Minimal shape a fallback/composed email needs to satisfy downstream
 * (matches the fields of ComposedEmail in skill.ts without importing it, to
 * keep this module dependency-free). */
export interface GenericEmailLike {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  aiReasoning: string;
}

/**
 * Deterministic, clearly-labeled generic-safe fallback used when the LLM
 * fails guardrails twice (initial attempt + one regeneration). Never
 * references a fact that wasn't explicitly verified — it only uses role,
 * company, and sender name, all of which are structural inputs, not
 * inferred content. Guaranteed to itself pass `checkEmailGuardrails`
 * (no hook is passed to the check, so grounding doesn't apply to it).
 */
export function buildGenericFallbackEmail(input: {
  recipientName?: string | null;
  recipientTitle?: string | null;
  companyName?: string | null;
  senderName?: string | null;
  senderCompany?: string | null;
  offeringSummary?: string | null;
}): GenericEmailLike {
  const firstName = (input.recipientName ?? "").trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const roleClause = input.recipientTitle
    ? `${input.recipientTitle}s${input.companyName ? ` at companies like ${input.companyName}` : ""}`
    : input.companyName
      ? `teams at ${input.companyName}`
      : "teams like yours";
  const offering = (input.offeringSummary ?? "").trim();
  const offeringClause = offering
    ? offering
    : `what ${input.senderCompany ?? "we"} ${input.senderCompany ? "does" : "do"}`;

  const bodyText = [
    greeting,
    `${roleClause[0].toUpperCase()}${roleClause.slice(1)} often run into the exact problem ${offeringClause} solves — figured it was worth a note.`,
    `Worth a quick reply if it's relevant to what you're working on?`,
    input.senderName ? `${input.senderName}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const bodyHtml = bodyText
    .split("\n\n")
    .map((line) => `<p>${line}</p>`)
    .join("");

  return {
    subject: "Quick note",
    bodyHtml,
    bodyText,
    aiReasoning:
      "GENERIC-SAFE FALLBACK: the AI-generated draft failed guardrail checks (grounding, length, banned phrases, or CTA) on both the original attempt and one regeneration, so a deterministic, fact-free template was used instead. Review before sending.",
  };
}

/**
 * Runtime (not just type-level) guard against ever persisting an
 * `email_drafts` row with a status other than "draft". This system is
 * draft-first by design (see db/schema.ts) — this assertion exists so that
 * a future refactor of the persistence path can't silently regress into
 * writing "sent" or auto-approving without a human in the loop.
 *
 * Throws rather than returning a boolean: this must be impossible to ignore
 * at a call site, matching "assertion/guard, not just convention" from the
 * spec.
 */
export function assertDraftOnly(values: { status?: string | null }): void {
  if (
    values.status !== undefined &&
    values.status !== null &&
    values.status !== "draft"
  ) {
    throw new Error(
      `Guardrail violation: attempted to persist an email_drafts row with status "${values.status}" — the composition pipeline may only ever write status "draft". Sending requires a separate, explicit human-reviewed action.`,
    );
  }
}
