import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
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

const COMPANY_BATCH_SIZE = 10;
const PERSON_BATCH_SIZE = 10;

const verificationResultSchema = z.object({
  verifications: z.array(
    z.object({
      id: z.string(),
      passes: z.boolean(),
      reason: z.string().max(200),
    }),
  ),
});

// ---------------------------------------------------------------------------
// verifyCompanies
// ---------------------------------------------------------------------------

export async function verifyCompanies(
  companies: Company[],
  criteria: string,
): Promise<VerifiedCompany[]> {
  const results: VerifiedCompany[] = [];

  for (let i = 0; i < companies.length; i += COMPANY_BATCH_SIZE) {
    const batch = companies.slice(i, i + COMPANY_BATCH_SIZE);

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

    const { object } = await generateObject({
      model: getModelSync(Models.classification),
      schema: verificationResultSchema,
      system:
        "You are verifying whether B2B companies match a set of criteria. " +
        "For each company, determine if it clearly satisfies ALL stated criteria. " +
        "Be strict — if a criterion is ambiguous or unclear from the data, mark it as failing. " +
        "Keep reasons under 200 characters.",
      prompt:
        `Criteria: ${criteria}\n\n` +
        `Companies to verify:\n${JSON.stringify(batchPayload, null, 2)}`,
    });

    // Build a lookup map for verification results
    const verificationMap = new Map(object.verifications.map((v) => [v.id, v]));

    for (const company of batch) {
      const verification = verificationMap.get(company.id);
      results.push({
        ...company,
        passes: verification?.passes ?? false,
        reason: verification?.reason ?? "No verification result returned.",
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// verifyPeople
// ---------------------------------------------------------------------------

export async function verifyPeople(
  people: Person[],
  criteria: string,
): Promise<VerifiedPerson[]> {
  const results: VerifiedPerson[] = [];

  for (let i = 0; i < people.length; i += PERSON_BATCH_SIZE) {
    const batch = people.slice(i, i + PERSON_BATCH_SIZE);

    const batchPayload = batch.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      title: p.title,
      company_name: p.company_name,
      location: p.location,
    }));

    const { object } = await generateObject({
      model: getModelSync(Models.classification),
      schema: verificationResultSchema,
      system:
        "You are verifying whether B2B contacts match a set of criteria. " +
        "For each person, determine if it clearly satisfies ALL stated criteria. " +
        "Be strict — if a criterion is ambiguous or unclear from the data, mark it as failing. " +
        "Keep reasons under 200 characters.",
      prompt:
        `Criteria: ${criteria}\n\n` +
        `People to verify:\n${JSON.stringify(batchPayload, null, 2)}`,
    });

    const verificationMap = new Map(object.verifications.map((v) => [v.id, v]));

    for (const person of batch) {
      const verification = verificationMap.get(person.id);
      results.push({
        ...person,
        passes: verification?.passes ?? false,
        reason: verification?.reason ?? "No verification result returned.",
      });
    }
  }

  return results;
}
