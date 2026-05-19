/**
 * Smoke test for the pgvector + local-embeddings semantic search pipeline.
 *
 * Requires:
 *   - Postgres running with the pgvector extension
 *   - `pnpm db:migrate` applied (so the embedding column + HNSW index exist)
 *
 * What it does:
 *   1. Inserts 5 sample organizations across diverse industries.
 *   2. Embeds + writes vectors for each via the same path the bulk indexer uses.
 *   3. Runs 3 semantic queries and asserts the top hit is in the expected industry.
 *   4. Cleans up the inserted rows + their queue entries on exit (success or failure).
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { embedBatch, embedText } from "../src/lib/services/embedding-service";

const SAMPLES = [
  {
    name: "Helix AI Labs",
    domain: "helix-test-pgvector.example",
    industry: "SaaS",
    description:
      "AI startup building large language model tooling and developer agents for enterprises.",
  },
  {
    name: "VitaMend Health",
    domain: "vitamend-test-pgvector.example",
    industry: "Healthcare",
    description:
      "Hospital network and primary-care provider running clinics across the Midwest.",
  },
  {
    name: "Northwind Capital",
    domain: "northwind-test-pgvector.example",
    industry: "Fintech",
    description:
      "Digital banking and payments platform offering corporate cards and treasury services.",
  },
  {
    name: "Ironforge Components",
    domain: "ironforge-test-pgvector.example",
    industry: "Manufacturing",
    description:
      "Heavy industrial manufacturer producing forged steel parts for automotive and energy.",
  },
  {
    name: "Drift & Co.",
    domain: "drift-test-pgvector.example",
    industry: "E-commerce",
    description:
      "Direct-to-consumer online retail brand selling apparel and lifestyle goods.",
  },
] as const;

type Sample = (typeof SAMPLES)[number];

function expectIndustry(industry: string) {
  return (results: Array<{ industry: string | null }>) => {
    if (results.length === 0) {
      throw new Error(`No results for query expecting industry=${industry}`);
    }
    const top = results[0];
    if (top.industry !== industry) {
      throw new Error(
        `Expected top industry=${industry}, got industry=${top.industry ?? "null"} (${JSON.stringify(top)})`,
      );
    }
  };
}

async function cleanup(domains: string[]) {
  if (domains.length === 0) return;
  const ids = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(inArray(schema.organizations.domain, domains));
  if (ids.length === 0) return;
  const idList = ids.map((r) => r.id);
  // Defensive: scrub any campaign joins / queue entries that point at our test rows.
  try {
    await db
      .delete(schema.campaignOrganizations)
      .where(inArray(schema.campaignOrganizations.organizationId, idList));
  } catch {
    // table may not be relevant in dev; ignore
  }
  await db
    .delete(schema.organizations)
    .where(inArray(schema.organizations.id, idList));
}

async function semanticSearch(query: string, limit = 5) {
  const vector = await embedText(query);
  const vectorLiteral = `[${vector.join(",")}]`;
  const rows = (await db.execute(sql`
    SELECT id::text AS id, name, industry, description,
           (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM organizations
    WHERE embedding IS NOT NULL
      AND domain IN (
        ${sql.join(
          SAMPLES.map((s) => sql`${s.domain}`),
          sql`, `,
        )}
      )
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    name: string;
    industry: string | null;
    description: string | null;
    distance: number;
  }>;
  return rows;
}

async function main() {
  const domains = SAMPLES.map((s) => s.domain);

  // Pre-cleanup in case a previous run aborted.
  await cleanup([...domains]);

  console.log("[test-pgvector] inserting samples…");
  // Insert each; capture inserted ids so we can update embeddings in place.
  const inserted: Array<{ id: string; sample: Sample }> = [];
  for (const sample of SAMPLES) {
    const [row] = await db
      .insert(schema.organizations)
      .values({
        name: sample.name,
        domain: sample.domain,
        industry: sample.industry,
        description: sample.description,
      })
      .returning({ id: schema.organizations.id });
    inserted.push({ id: row.id, sample });
  }

  console.log("[test-pgvector] embedding samples…");
  const texts = inserted.map(({ sample }) =>
    [sample.name, sample.industry, sample.description].join(" — "),
  );
  const vectors = await embedBatch(texts);
  for (let i = 0; i < inserted.length; i++) {
    await db
      .update(schema.organizations)
      .set({ embedding: vectors[i] })
      .where(eq(schema.organizations.id, inserted[i].id));
  }

  const cases: Array<{
    query: string;
    assert: (rows: Array<{ industry: string | null }>) => void;
  }> = [
    { query: "AI startup", assert: expectIndustry("SaaS") },
    { query: "industrial company", assert: expectIndustry("Manufacturing") },
    { query: "healthcare provider", assert: expectIndustry("Healthcare") },
  ];

  let failures = 0;
  for (const c of cases) {
    const rows = await semanticSearch(c.query);
    console.log(
      `[test-pgvector] query=${JSON.stringify(c.query)} top=${rows
        .slice(0, 3)
        .map((r) => `${r.industry}(d=${Number(r.distance).toFixed(3)})`)
        .join(", ")}`,
    );
    try {
      c.assert(rows);
      console.log(`  ✓ pass`);
    } catch (err) {
      failures++;
      console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return failures;
}

main()
  .then(async (failures) => {
    await cleanup(SAMPLES.map((s) => s.domain));
    if (failures > 0) {
      console.error(`[test-pgvector] ${failures} assertion(s) failed.`);
      process.exit(1);
    }
    console.log("[test-pgvector] all assertions passed.");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[test-pgvector] unexpected error:", err);
    try {
      await cleanup(SAMPLES.map((s) => s.domain));
    } catch {
      // best effort
    }
    process.exit(1);
  });
