import "server-only";
import { generateText } from "ai";
import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { CompanySearchParamsSchema, PeopleSearchParamsSchema } from "./schemas";
import type { CompanySearchParams, PeopleSearchParams } from "./schemas";

const COMPANY_SCHEMA_DESC = `{
  "q": "optional free-text search string",
  "industry": "optional string or array of strings — e.g. 'SaaS', 'Fintech', 'Healthcare'",
  "country": "optional string or array — e.g. 'USA', 'UK', 'Germany'",
  "state": "optional US state abbreviation string or array — e.g. 'CA', 'NY'",
  "city": "optional string or array",
  "employee_min": "optional integer — minimum employee count",
  "employee_max": "optional integer — maximum employee count",
  "funding_stage": "optional string or array — one of: seed, series_a, series_b, series_c, growth, ipo",
  "funding_min_usd": "optional number — minimum total funding in USD",
  "funding_max_usd": "optional number — maximum total funding in USD",
  "technologies": "optional string or array of tech/tool names",
  "founded_after": "optional date string YYYY-MM-DD",
  "founded_before": "optional date string YYYY-MM-DD"
}`;

const PEOPLE_SCHEMA_DESC = `{
  "q": "optional free-text search string",
  "title": "optional job title string or array — e.g. 'VP of Engineering', 'CTO'",
  "seniority": "optional string or array — one of: c_suite, vp, director, manager, senior, ic",
  "department": "optional string or array — e.g. 'Engineering', 'Sales', 'Marketing'",
  "country": "optional string or array — e.g. 'USA', 'UK'",
  "company_industry": "optional string or array — e.g. 'SaaS', 'Fintech'",
  "company_employee_min": "optional integer",
  "company_employee_max": "optional integer"
}`;

function extractJson(text: string): unknown {
  // Strip markdown code fences if present
  const stripped = text
    .replace(/```(?:json)?\n?/g, "")
    .replace(/\n?```/g, "")
    .trim();
  // Find first { and last }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  return JSON.parse(stripped.slice(start, end + 1));
}

export async function translateCompanyCriteria(
  criteria: string,
): Promise<CompanySearchParams> {
  const { text } = await generateText({
    model: getModelSync(Models.classification),
    system:
      "You are a search query builder for a B2B prospecting database with 120M+ contacts. " +
      "Translate natural language company search criteria into a JSON object of API query parameters. " +
      "Return ONLY a valid JSON object — no explanation, no markdown, no code fences. " +
      "Only include fields that are clearly stated or strongly implied by the criteria. " +
      `The JSON object may have these optional fields:\n${COMPANY_SCHEMA_DESC}`,
    prompt: `Criteria: ${criteria}\n\nReturn a JSON object of query parameters:`,
  });

  try {
    const raw = extractJson(text);
    return CompanySearchParamsSchema.parse({
      ...(raw as object),
      page: 1,
      per_page: 25,
    });
  } catch {
    return CompanySearchParamsSchema.parse({ page: 1, per_page: 25 });
  }
}

export async function translatePeopleCriteria(
  criteria: string,
): Promise<PeopleSearchParams> {
  const { text } = await generateText({
    model: getModelSync(Models.classification),
    system:
      "You are a search query builder for a B2B prospecting database with 120M+ contacts. " +
      "Translate natural language people search criteria into a JSON object of API query parameters. " +
      "Return ONLY a valid JSON object — no explanation, no markdown, no code fences. " +
      "Only include fields that are clearly stated or strongly implied by the criteria. " +
      `The JSON object may have these optional fields:\n${PEOPLE_SCHEMA_DESC}`,
    prompt: `Criteria: ${criteria}\n\nReturn a JSON object of query parameters:`,
  });

  try {
    const raw = extractJson(text);
    return PeopleSearchParamsSchema.parse({
      ...(raw as object),
      page: 1,
      per_page: 25,
    });
  } catch {
    return PeopleSearchParamsSchema.parse({ page: 1, per_page: 25 });
  }
}
