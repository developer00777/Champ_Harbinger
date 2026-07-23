import "server-only";

import { z } from "zod";

import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { getClassificationModelSync } from "@/lib/ai/provider";

/**
 * Reply-intent taxonomy. Keep in sync with `emailDrafts`/sequence-halt
 * consumers in respond.ts — this is the single source of truth for the set
 * of intents Port D understands.
 */
export const REPLY_INTENTS = [
  "interested",
  "meeting_request",
  "objection",
  "question",
  "not_now",
  "unsubscribe",
  "out_of_office",
  "wrong_person",
] as const;

export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export interface ClassifyInput {
  subject?: string | null;
  body?: string | null;
  fromAddress?: string | null;
}

export interface ClassifyResult {
  intent: ReplyIntent;
  confidence: number;
}

const ClassifySchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  confidence: z.number().min(0).max(1),
});

// ─── Deterministic pre-filter ──────────────────────────────────────────────
//
// unsubscribe and out_of_office are the two intents that MUST be caught
// reliably (a missed unsubscribe risks a compliance complaint; a missed OOO
// wastes a warm-intro/human-review slot on an autoresponder). Rather than
// trust an LLM call for these, we match cheap deterministic keyword patterns
// FIRST and never call the model when one hits. This is both more reliable
// and avoids burning a model call on messages that don't need one.

const UNSUBSCRIBE_PATTERNS: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bstop (emailing|contacting|messaging) me\b/i,
  /\bopt[-\s]?out\b/i,
  /\bdo not (email|contact|message) me\b/i,
  /\bplease stop\b/i,
  /\bno longer (wish|want) to (receive|be contacted)\b/i,
];

const OUT_OF_OFFICE_PATTERNS: RegExp[] = [
  /\bout of (the )?office\b/i,
  /\bout[-\s]?of[-\s]?office\b/i,
  /\bauto([-\s])?repl(y|ies)\b/i,
  /\bautomatic reply\b/i,
  /\bcurrently (away|out|on leave|on vacation|on holiday)\b/i,
  /\bon (annual|maternity|paternity|sick|medical) leave\b/i,
  /\bi(’|'| a)?m (away|on vacation|on holiday|out of the office)\b/i,
  /\breturn(ing)? (to the office )?on\b/i,
  /\bback in the office\b/i,
  /\blimited access to email\b/i,
];

function deterministicPreFilter(text: string): ClassifyResult | null {
  for (const pattern of UNSUBSCRIBE_PATTERNS) {
    if (pattern.test(text)) {
      return { intent: "unsubscribe", confidence: 1 };
    }
  }
  for (const pattern of OUT_OF_OFFICE_PATTERNS) {
    if (pattern.test(text)) {
      return { intent: "out_of_office", confidence: 0.97 };
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are classifying an inbound email reply to a cold-outreach sequence.

Choose exactly one intent from:
- interested: prospect expresses genuine interest in learning more / the offering
- meeting_request: prospect explicitly wants to schedule a call/meeting
- objection: prospect pushes back, raises a concern, or says "not interested" with a reason
- question: prospect asks a clarifying question without a clear yes/no signal
- not_now: prospect says the timing is bad but doesn't shut the door ("check back later", "reach out next quarter")
- unsubscribe: prospect asks to stop receiving emails (should rarely reach you — pre-filtered)
- out_of_office: an autoresponder / OOO message (should rarely reach you — pre-filtered)
- wrong_person: prospect says this isn't the right contact, wrong role, or "I don't work here anymore"

Return the single best-fit intent and a confidence score from 0 to 1.`;

/**
 * Classifies an inbound reply. Deterministic keyword pre-filter runs first
 * for unsubscribe/out_of_office (never reaches the LLM for those). Anything
 * else falls through to a classification model call.
 *
 * Throws on LLM failure — callers (respond.ts) are responsible for treating
 * a classification failure as "unknown intent, but the enrollment must
 * already be halted by the time this is called."
 */
export async function classifyReply(
  input: ClassifyInput,
): Promise<ClassifyResult> {
  const text = `${input.subject ?? ""}\n${input.body ?? ""}`.trim();

  const pre = deterministicPreFilter(text);
  if (pre) return pre;

  const { object } = await generateObject({
    model: getClassificationModelSync(),
    schema: ClassifySchema,
    system: SYSTEM_PROMPT,
    prompt: `FROM: ${input.fromAddress ?? "(unknown)"}\nSUBJECT: ${input.subject ?? "(none)"}\n\nBODY:\n${(input.body ?? "").slice(0, 6000)}`,
  });

  return object;
}
