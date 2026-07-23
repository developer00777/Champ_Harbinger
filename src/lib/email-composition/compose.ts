import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { getModelSync as getModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import {
  ComposedEmailSchema,
  buildComposeUserPrompt,
  buildEmailSystemPrompt,
  type ComposedEmail,
} from "./skill";
import {
  buildGenericFallbackEmail,
  checkEmailGuardrails,
  DEFAULT_BODY_WORD_LIMIT,
  type GuardrailViolation,
  type PrimaryHook,
} from "./guardrails";
import type { EmailSkill } from "@/lib/types/email-skill";

type UserPromptInput = Parameters<typeof buildComposeUserPrompt>[0];

export type ComposeInput = UserPromptInput & {
  skills?: EmailSkill[];
  /**
   * Person to fetch a verified `PrimaryHook` for (via Port A's
   * knowledge-graph retrieval, dynamically imported — see
   * `fetchPrimaryHook` below). Ignored if `personalizationHook` is passed
   * explicitly.
   */
  personId?: string;
  /** Pre-fetched hook, bypasses the personId lookup when supplied. */
  personalizationHook?: PrimaryHook | null;
  /** Hard cap on body word count. Defaults to DEFAULT_BODY_WORD_LIMIT. */
  wordLimit?: number;
};

export type ComposeResult =
  | {
      ok: true;
      email: ComposedEmail;
      guardrails: {
        wordCount: number;
        regenerated: boolean;
        usedFallback: boolean;
        violations: GuardrailViolation[];
      };
    }
  | { ok: false; error: string };

/**
 * Dynamically imports Port A's knowledge-graph retrieval and fetches the
 * verified primary hook for a person. Guarded exactly like other optional
 * cross-module deps in this codebase (see e.g.
 * src/lib/enrichment/engine.ts's knowledgeBaseSync import): the module may
 * not exist on disk yet (built concurrently by a sibling agent), and this
 * lookup is best-effort — personalization degrades gracefully to "no hook"
 * rather than failing composition.
 */
async function fetchPrimaryHook(personId: string): Promise<PrimaryHook | null> {
  try {
    const { getPersonContext } =
      await import("@/lib/knowledge-graph/retrieval");
    const context = await getPersonContext(personId);
    return context?.primaryHook ?? null;
  } catch {
    // Module not present yet, or lookup failed — compose without a hook.
    return null;
  }
}

/**
 * Single-email composition via generateObject. One focused Claude call per
 * contact × step. The system prompt is stable for a given (user, profile,
 * campaign, skills-set) so parallel fan-out hits prompt cache on all but the
 * first call.
 *
 * Model: deepseek-v4-flash (Models.personalization) — A/B-validated at parity
 * with claude-sonnet-4 on this task (see scripts/ab-personalization.mts) at a
 * fraction of the cost. Env-overridable via HARBINGER_PERSONALIZATION_MODEL.
 */
export async function composeEmail(
  input: ComposeInput,
): Promise<ComposeResult> {
  try {
    const {
      skills,
      personId,
      personalizationHook,
      wordLimit,
      ...userPromptInput
    } = input;

    const hook: PrimaryHook | null =
      personalizationHook !== undefined
        ? personalizationHook
        : personId
          ? await fetchPrimaryHook(personId)
          : null;

    const limit = wordLimit ?? DEFAULT_BODY_WORD_LIMIT;
    const system = buildEmailSystemPrompt(skills ?? []);
    const promptInput = { ...userPromptInput, primaryHook: hook };

    const generate = (extra?: string) =>
      generateObject({
        model: getModel(Models.personalization()),
        schema: ComposedEmailSchema,
        system,
        prompt: extra
          ? `${buildComposeUserPrompt(promptInput)}\n\n${extra}`
          : buildComposeUserPrompt(promptInput),
        providerOptions: {
          anthropic: {
            // Cache the stable system prompt across the fan-out batch.
            cacheControl: { type: "ephemeral" },
          },
        },
        maxOutputTokens: 1200,
      });

    let { object } = await generate();
    let check = checkEmailGuardrails(object, { hook, wordLimit: limit });
    let regenerated = false;
    let usedFallback = false;

    if (!check.ok) {
      regenerated = true;
      const violationSummary = check.violations
        .map((v) => `- ${v.message}`)
        .join("\n");
      const retry = await generate(
        `REGENERATE: your previous draft violated these hard rules and was rejected:\n${violationSummary}\nFix ALL of them. Stay under ${limit} words. Do not use fake-familiarity openers. End on a single low-commitment question.`,
      );
      object = retry.object;
      check = checkEmailGuardrails(object, { hook, wordLimit: limit });
    }

    if (!check.ok) {
      usedFallback = true;
      const contact = userPromptInput.contact;
      const company = userPromptInput.company;
      const offering = userPromptInput.campaign?.offering;
      object = buildGenericFallbackEmail({
        recipientName: contact?.name ?? null,
        recipientTitle: contact?.title ?? null,
        companyName: company?.name ?? null,
        senderName: userPromptInput.senderProfile?.name ?? null,
        senderCompany: userPromptInput.senderProfile?.company ?? null,
        offeringSummary:
          offering && typeof offering === "object"
            ? JSON.stringify(offering).slice(0, 200)
            : null,
      });
      check = checkEmailGuardrails(object, { wordLimit: limit });
    }

    return {
      ok: true,
      email: object,
      guardrails: {
        wordCount: check.wordCount,
        regenerated,
        usedFallback,
        violations: check.violations,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown composition error",
    };
  }
}

/**
 * Run an async task-returning function against items with bounded concurrency.
 * Small local helper — avoids pulling in p-limit for one call site.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
