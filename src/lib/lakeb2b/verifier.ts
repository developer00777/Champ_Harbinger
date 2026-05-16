import "server-only";
import { generateText } from "ai";
import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import type { Company, Person } from "./schemas";

export interface VerifiedCompany extends Company {
  passes: boolean;
  reason: string;
}

export interface VerifiedPerson extends Person {
  passes: boolean;
  reason: string;
}

const BATCH_SIZE = 10;

interface VerificationResult {
  id: string;
  passes: boolean;
  reason: string;
}

function extractVerifications(text: string): VerificationResult[] {
  const stripped = text
    .replace(/```(?:json)?\n?/g, "")
    .replace(/\n?```/g, "")
    .trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(stripped.slice(start, end + 1)) as unknown[];
    return arr
      .filter(
        (v): v is Record<string, unknown> =>
          typeof v === "object" && v !== null,
      )
      .map((v) => ({
        id: String(v.id ?? ""),
        passes: Boolean(v.passes),
        reason: String(v.reason ?? ""),
      }));
  } catch {
    return [];
  }
}

export async function verifyCompanies(
  companies: Company[],
  criteria: string,
): Promise<VerifiedCompany[]> {
  const results: VerifiedCompany[] = [];

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);

    const batchPayload = batch.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      employee_count: c.employee_count,
      location: c.location,
      funding_stage: c.funding_stage,
      funding_total_usd: c.funding_total_usd,
      description: c.description,
    }));

    const { text } = await generateText({
      model: getModelSync(Models.classification),
      system:
        "You are verifying whether B2B companies match a set of criteria. " +
        "For each company, determine if it clearly satisfies ALL stated criteria. " +
        "Be strict — if a criterion is ambiguous or unclear from the data, mark it as failing. " +
        "Return ONLY a JSON array — no explanation, no markdown, no code fences. " +
        'Each element: { "id": "<company id>", "passes": true/false, "reason": "<one sentence under 150 chars>" }',
      prompt:
        `Criteria: ${criteria}\n\n` +
        `Companies to verify:\n${JSON.stringify(batchPayload, null, 2)}\n\n` +
        "Return a JSON array of verifications:",
    });

    const verifications = extractVerifications(text);
    const verificationMap = new Map(verifications.map((v) => [v.id, v]));

    for (const company of batch) {
      const v = verificationMap.get(company.id);
      results.push({
        ...company,
        passes: v?.passes ?? false,
        reason: v?.reason ?? "Could not verify against criteria.",
      });
    }
  }

  return results;
}

export async function verifyPeople(
  people: Person[],
  criteria: string,
): Promise<VerifiedPerson[]> {
  const results: VerifiedPerson[] = [];

  for (let i = 0; i < people.length; i += BATCH_SIZE) {
    const batch = people.slice(i, i + BATCH_SIZE);

    const batchPayload = batch.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      title: p.title,
      company_name: p.company_name,
      location: p.location,
    }));

    const { text } = await generateText({
      model: getModelSync(Models.classification),
      system:
        "You are verifying whether B2B contacts match a set of criteria. " +
        "For each person, determine if it clearly satisfies ALL stated criteria. " +
        "Be strict — if a criterion is ambiguous or unclear from the data, mark it as failing. " +
        "Return ONLY a JSON array — no explanation, no markdown, no code fences. " +
        'Each element: { "id": "<person id>", "passes": true/false, "reason": "<one sentence under 150 chars>" }',
      prompt:
        `Criteria: ${criteria}\n\n` +
        `People to verify:\n${JSON.stringify(batchPayload, null, 2)}\n\n` +
        "Return a JSON array of verifications:",
    });

    const verifications = extractVerifications(text);
    const verificationMap = new Map(verifications.map((v) => [v.id, v]));

    for (const person of batch) {
      const v = verificationMap.get(person.id);
      results.push({
        ...person,
        passes: v?.passes ?? false,
        reason: v?.reason ?? "Could not verify against criteria.",
      });
    }
  }

  return results;
}
