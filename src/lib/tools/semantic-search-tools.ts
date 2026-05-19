import "server-only";
import { tool } from "ai";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminDb } from "@/lib/db/admin";
import { embedText } from "@/lib/services/embedding-service";

type SemanticRow = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  description: string | null;
  distance: number;
};

export const semanticSearchCompanies = tool({
  description:
    "Semantic search over the local `organizations` table using pgvector + local embeddings. " +
    "Embeds the natural-language query with all-MiniLM-L6-v2 (zero per-query LLM cost) and " +
    "ranks rows by cosine distance against the HNSW-indexed `embedding` column. " +
    "Use for fuzzy / intent-based discovery over already-indexed companies (e.g. 'AI startup', " +
    "'industrial company in the Midwest'). For fresh discovery against the 120M+ LakeB2B pool, " +
    "use `discoverWithLakeB2B` instead.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "Natural language description of the kind of company you want to find.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .optional()
      .describe("Max results to return (default 20, hard max 200)."),
    minDistance: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe(
        "Drop results whose cosine distance is >= this value. Lower = stricter. " +
          "Cosine distance is in [0, 2]; with normalized embeddings, < 0.5 is typically 'close'.",
      ),
  }),
  execute: async ({ query, limit = 20, minDistance }) => {
    const vector = await embedText(query);
    const vectorLiteral = `[${vector.join(",")}]`;

    // ORDER BY embedding <=> $1 lets Postgres use the HNSW index.
    // We over-fetch only if a distance filter is applied client-side.
    const rows = (await adminDb.execute(sql`
      SELECT
        id::text          AS id,
        name              AS name,
        domain            AS domain,
        industry          AS industry,
        description       AS description,
        (embedding <=> ${vectorLiteral}::vector) AS distance
      FROM organizations
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `)) as unknown as SemanticRow[];

    const filtered =
      typeof minDistance === "number"
        ? rows.filter((r) => Number(r.distance) < minDistance)
        : rows;

    return {
      query,
      count: filtered.length,
      results: filtered.map((r) => ({
        id: r.id,
        name: r.name,
        domain: r.domain,
        industry: r.industry,
        description: r.description,
        distance: Number(r.distance),
      })),
    };
  },
});
