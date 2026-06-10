import { getModelSync as getModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { generateObject, jsonSchema } from "ai";
import { eq, desc, gte, and } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { recordAiUsage } from "@/lib/ai/usage";
import {
  withObscuraPage,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";
import { structuralDiff } from "./diff";
import { resolveArgs, resolvePath, renderTemplate } from "./paths";
import { getRecipeTool } from "./tool-registry";
import type { Db } from "@/db";

import type {
  RecipeContext,
  RecipeStep,
  SignalEvidence,
  SignalOutput,
  SignalRecipe,
  StepResults,
} from "./types";

export interface RunRecipeOptions {
  recipe: SignalRecipe;
  context: RecipeContext;
  db?: Db;
  onStep?: (step: RecipeStep, result: unknown) => void;
}

export async function runRecipe(
  options: RunRecipeOptions,
): Promise<{ output: SignalOutput; steps: StepResults }> {
  const { recipe, context, onStep } = options;
  const db = options.db ?? (await getScopedDb()).raw;
  const steps: StepResults = {};
  const scope = buildScope(context, steps);

  for (const step of recipe.steps) {
    const result = await executeStep(step, scope, {
      signalId: context.signalId,
      organizationId: context.organizationId,
      db,
    });
    steps[step.id] = result;
    onStep?.(step, result);
  }

  const output = buildOutput(recipe, scope);
  return { output, steps };
}

function buildScope(
  context: RecipeContext,
  steps: StepResults,
): Record<string, unknown> {
  return { context, ...steps };
}

async function executeStep(
  step: RecipeStep,
  scope: Record<string, unknown>,
  env: {
    signalId: string;
    organizationId: string;
    db: Db;
  },
): Promise<unknown> {
  switch (step.kind) {
    case "tool": {
      const tool = getRecipeTool(step.tool);
      const args = resolveArgs(step.args, scope);
      if (!tool.execute) {
        throw new Error(`Tool "${step.tool}" has no execute function`);
      }
      try {
        const result = await tool.execute(args, {
          toolCallId: `recipe-${step.id}`,
          messages: [],
        });
        return result;
      } catch (err) {
        if (step.onError === "skip") {
          return { error: String(err) };
        }
        throw err;
      }
    }
    case "stagehand": {
      const url = resolveArgs({ url: step.url }, scope).url as string;
      // "stagehand" is a legacy step name; it now runs on the self-hosted
      // Obscura browser + an OpenRouter LLM for extraction (no Browserbase).
      if (!isObscuraConfigured()) {
        return { url, extracted: null };
      }
      return withObscuraPage(async (page) => {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        for (const action of step.actions ?? []) {
          if (action.op === "act") {
            // Best-effort: if the rendered instruction is a usable CSS
            // selector, click it; otherwise skip the LLM-driven act.
            const instruction = renderTemplate(action.instruction, scope);
            const selector = instruction.trim();
            if (isLikelySelector(selector)) {
              try {
                await page.click(selector, { timeout: 5000 });
              } catch {
                // selector not present -- skip gracefully
              }
            }
          } else if (action.op === "waitMs") {
            await page.waitForTimeout(action.ms);
          }
        }
        const html = await page.content();
        const startedAt = Date.now();
        const result = await generateObject({
          model: getModel(step.model ?? Models.classification),
          schema: jsonSchema(step.extract.schema),
          prompt: `${renderTemplate(step.extract.instruction, scope)}\n\n---\n\n${html.slice(0, 30_000)}`,
        });
        recordAiUsage(result, {
          operation: "signal-stagehand-extract",
          costModel: "haiku",
          modelLabel: step.model ?? Models.classification,
          startedAt,
          metadata: { signalId: env.signalId, url: page.url() },
        });
        return { url: page.url(), extracted: result.object };
      });
    }
    case "history": {
      if (!isUuid(env.signalId) || !isUuid(env.organizationId)) {
        return { present: false, value: null, reason: "dryrun" };
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (step.maxAgeDays ?? 90));
      const [data] = await env.db
        .select({
          output: schema.signalResults.output,
          ranAt: schema.signalResults.ranAt,
        })
        .from(schema.signalResults)
        .where(
          and(
            eq(schema.signalResults.signalId, env.signalId),
            eq(schema.signalResults.organizationId, env.organizationId),
            gte(schema.signalResults.ranAt, cutoff),
          ),
        )
        .orderBy(desc(schema.signalResults.ranAt))
        .limit(1);
      if (!data) return { present: false, value: null };
      const output = data.output as Record<string, unknown>;
      const value = step.path ? resolvePath(output, step.path) : output;
      return { present: true, value, ran_at: data.ranAt };
    }
    case "diff": {
      const baseline = resolvePath(scope, step.baseline);
      const current = resolvePath(scope, step.current);
      return structuralDiff(baseline, current, step.keyBy);
    }
    case "extract_json": {
      const source = resolvePath(scope, step.from);
      if (typeof source !== "string" || !source.trim()) {
        return null;
      }
      const { object } = await generateObject({
        model: getModel(step.model ?? Models.classification),
        schema: jsonSchema(step.schema),
        prompt: `${step.prompt}\n\n---\n\n${source.slice(0, 30_000)}`,
      });
      return object;
    }
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Heuristic: treat the act instruction as a CSS selector only when it looks
 * like one (no whitespace-y prose) so we can click it directly. Otherwise the
 * act is a natural-language instruction we can't honor without an LLM agent and
 * is skipped gracefully.
 */
function isLikelySelector(value: string): boolean {
  if (!value || value.length > 200 || /\s{2,}/.test(value)) return false;
  // Reject sentence-like instructions (multiple words separated by spaces).
  if (value.split(/\s+/).length > 1 && !value.startsWith("#")) return false;
  return /^[#.\[]|^[a-z][a-z0-9-]*[#.\[:>~+]|^[a-z][a-z0-9-]*$/i.test(value);
}

function buildOutput(
  recipe: SignalRecipe,
  scope: Record<string, unknown>,
): SignalOutput {
  const spec = recipe.output;
  const foundRaw = resolvePath(scope, spec.foundPath);
  const found = !!foundRaw;
  const summary = renderTemplate(spec.summaryTemplate, scope).trim();
  const evidence: SignalEvidence[] = [];
  for (const ev of spec.evidence) {
    const url = resolvePath(scope, ev.urlPath);
    const snippet = resolvePath(scope, ev.snippetPath);
    if (typeof url === "string" && url) {
      evidence.push({
        url,
        snippet:
          typeof snippet === "string"
            ? snippet.slice(0, 280)
            : snippet == null
              ? ""
              : JSON.stringify(snippet).slice(0, 280),
      });
    }
  }
  const data = spec.dataPath
    ? ((resolvePath(scope, spec.dataPath) as
        | Record<string, unknown>
        | undefined) ?? {})
    : {};
  const diff = spec.diffPath
    ? (resolvePath(scope, spec.diffPath) as SignalOutput["diff"])
    : undefined;
  return {
    found,
    summary: summary || (found ? "Signal fired." : "No match."),
    evidence,
    data,
    diff,
    confidence: spec.confidence ?? "medium",
  };
}
