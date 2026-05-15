import "server-only";
import { generateObject } from "ai";
import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { CompanySearchParamsSchema, PeopleSearchParamsSchema } from "./schemas";
import type { CompanySearchParams, PeopleSearchParams } from "./schemas";

export async function translateCompanyCriteria(
  criteria: string,
): Promise<CompanySearchParams> {
  const schema = CompanySearchParamsSchema.omit({ page: true, per_page: true });

  const { object } = await generateObject({
    model: getModelSync(Models.classification),
    schema,
    system:
      "You are a search query builder for a B2B prospecting database with 120M+ contacts. " +
      "Translate the user's natural language company search criteria into structured API query parameters. " +
      "Be precise and conservative — only set parameters that are clearly stated or strongly implied.",
    prompt: `Criteria: ${criteria}\n\nExtract query parameters from these criteria.`,
  });

  // Re-parse with defaults applied
  return CompanySearchParamsSchema.parse({ ...object, page: 1, per_page: 25 });
}

export async function translatePeopleCriteria(
  criteria: string,
): Promise<PeopleSearchParams> {
  const schema = PeopleSearchParamsSchema.omit({ page: true, per_page: true });

  const { object } = await generateObject({
    model: getModelSync(Models.classification),
    schema,
    system:
      "You are a search query builder for a B2B prospecting database with 120M+ contacts. " +
      "Translate the user's natural language people search criteria into structured API query parameters. " +
      "Be precise and conservative — only set parameters that are clearly stated or strongly implied.",
    prompt: `Criteria: ${criteria}\n\nExtract query parameters from these criteria.`,
  });

  return PeopleSearchParamsSchema.parse({ ...object, page: 1, per_page: 25 });
}
