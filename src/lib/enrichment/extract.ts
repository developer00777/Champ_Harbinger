import "server-only";
import { z } from "zod";

import { buildFieldValue } from "./confidence";
import type { EnrichmentSettings } from "./config";
import type { FieldValue } from "./types";

/**
 * LLM extraction from scraped content - the heart of owned, OpenRouter-only
 * enrichment.
 *
 * Given scraped public text (company site, team/contact page) and/or a scraped
 * social profile JSON plus the seed identity, ask the model to pull canonical
 * contact fields + firmographics, then stamp each with provenance and a
 * confidence computed from the model (source "owned_scrape", unverified - the
 * email gate verifies email downstream).
 *
 * The model call is INJECTED (deps.generateObject) so unit tests pass a fake and
 * this module stays deterministic and network-free under test. In production the
 * default wires the real AI SDK generateObject through getModel (OpenRouter).
 */

const ExtractionSchema = z.object({
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  linkedin: z.string().nullable().optional(),
  /** Recent social/news posts, used later for engagement / intent signals. */
  recentPosts: z.array(z.string()).nullable().optional(),
  /**
   * Personalization signals lifted from a public profile (LinkedIn/X). These
   * feed outreach personalization; they are NOT identity/contact fields, so they
   * ride in firmographics.personalization rather than the canonical field store.
   */
  personalization: z
    .object({
      about: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      current_company: z.string().nullable().optional(),
      current_role: z.string().nullable().optional(),
      experience: z.array(z.string()).nullable().optional(),
      education: z.array(z.string()).nullable().optional(),
      skills: z.array(z.string()).nullable().optional(),
      recent_activity: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
  firmographics: z
    .object({
      company_name: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      employee_count: z.union([z.string(), z.number()]).nullable().optional(),
      revenue_band: z.string().nullable().optional(),
      funding_stage: z.string().nullable().optional(),
      funding_total_usd: z
        .union([z.string(), z.number()])
        .nullable()
        .optional(),
      recent_role_change: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type ExtractionObject = z.infer<typeof ExtractionSchema>;

export interface ExtractInput {
  scrapedText: string;
  seed: {
    fullName?: string | null;
    domain?: string | null;
    company?: string | null;
  };
  /** Optional structured social profile (LinkedIn/X) to extract from too. */
  profileJson?: unknown;
}

/** Injected model call. Returns an object validated against ExtractionSchema. */
export type GenerateObjectFn = (args: {
  schema: unknown;
  prompt: string;
}) => Promise<{ object: Record<string, unknown> }>;

export interface ExtractDeps {
  generateObject?: GenerateObjectFn;
  /** Clerk user id for per-user OpenRouter key resolution (production only). */
  clerkUserId?: string;
}

function emptyish(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function buildPrompt(input: ExtractInput): string {
  const seedLines = [
    input.seed.fullName ? `Name: ${input.seed.fullName}` : null,
    input.seed.company ? `Company: ${input.seed.company}` : null,
    input.seed.domain ? `Domain: ${input.seed.domain}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const profile = input.profileJson
    ? `\n\nStructured profile JSON:\n${JSON.stringify(input.profileJson).slice(0, 8000)}`
    : "";
  return [
    "You extract B2B contact and company facts from scraped public web content.",
    "Only return facts clearly supported by the content. Use null for anything not present.",
    "Prefer a work email over a personal one. Normalize a LinkedIn URL to its canonical https form.",
    "When the content is a LinkedIn/social profile, also fill `personalization` with what the page states: a short `about`/summary, `location`, `current_company`/`current_role`, past `experience` and `education` as short strings, `skills`, and any `recent_activity`/posts. Never invent these — omit or use null when absent.",
    seedLines ? `\nKnown identity:\n${seedLines}` : "",
    `\n\nScraped content:\n${input.scrapedText.slice(0, 12000)}${profile}`,
  ].join("");
}

/**
 * Default production model call: real AI SDK generateObject through OpenRouter.
 * Lazy-imported so unit tests (which inject a fake) never load the AI stack.
 */
async function defaultGenerateObject(
  clerkUserId: string | undefined,
  args: { schema: unknown; prompt: string },
): Promise<{ object: Record<string, unknown> }> {
  const [{ generateObjectLimited: generateObject }, { getModel }, { Models }] =
    await Promise.all([
      import("@/lib/ai/generate"),
      import("@/lib/ai/provider"),
      import("@/lib/ai/models"),
    ]);
  const model = await getModel(Models.classification, clerkUserId);
  // args.schema is always ExtractionSchema; use it directly so the AI SDK can
  // infer the object type without an unsafe cast.
  void args.schema;
  const result = await generateObject({
    model,
    schema: ExtractionSchema,
    prompt: args.prompt,
  });
  return { object: result.object as Record<string, unknown> };
}

/**
 * Extract canonical FieldValues + firmographics from scraped content.
 * Returns empty maps (no model call) when there is no content to read.
 */
export async function extractContactFields(
  input: ExtractInput,
  settings: EnrichmentSettings,
  deps: ExtractDeps = {},
): Promise<{
  fields: Record<string, FieldValue>;
  firmographics: Record<string, unknown>;
}> {
  const fields: Record<string, FieldValue> = {};
  const firmographics: Record<string, unknown> = {};

  const hasContent =
    (input.scrapedText && input.scrapedText.trim().length > 0) ||
    input.profileJson !== undefined;
  if (!hasContent) return { fields, firmographics };

  const generate =
    deps.generateObject ??
    ((args: { schema: unknown; prompt: string }) =>
      defaultGenerateObject(deps.clerkUserId, args));

  let object: Record<string, unknown>;
  try {
    const res = await generate({
      schema: ExtractionSchema,
      prompt: buildPrompt(input),
    });
    object = res.object ?? {};
  } catch {
    // Extraction failure degrades to an empty result; the waterfall escalates.
    return { fields, firmographics };
  }

  const parsed = ExtractionSchema.safeParse(object);
  const data: ExtractionObject = parsed.success
    ? parsed.data
    : (object as ExtractionObject);

  const scalarFields: Array<keyof ExtractionObject> = [
    "email",
    "phone",
    "title",
    "seniority",
    "linkedin",
  ];
  for (const key of scalarFields) {
    const value = data[key];
    if (emptyish(value)) continue;
    fields[key] = buildFieldValue({
      value,
      provider: "owned_scrape",
      settings,
      // email stays unverified so the downstream gate runs on it.
      verified: false,
    });
  }

  if (data.firmographics && typeof data.firmographics === "object") {
    for (const [k, v] of Object.entries(data.firmographics)) {
      if (!emptyish(v)) firmographics[k] = v;
    }
  }
  if (Array.isArray(data.recentPosts) && data.recentPosts.length > 0) {
    firmographics.recent_posts = data.recentPosts;
  }

  if (data.personalization && typeof data.personalization === "object") {
    const personalization: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.personalization)) {
      if (!emptyish(v)) personalization[k] = v;
    }
    if (Object.keys(personalization).length > 0) {
      firmographics.personalization = personalization;
    }
  }

  return { fields, firmographics };
}
