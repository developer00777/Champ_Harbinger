/**
 * Bulk embedding indexer for the `organizations` table.
 *
 * Streams rows in paginated chunks (default 500/page), builds a single text
 * blob per company from name + industry + description, embeds in batches of
 * 32 with the local MiniLM model, and writes the vector back to the row.
 *
 * Usage:
 *   pnpm exec tsx scripts/index-organizations.ts            # index missing only
 *   pnpm exec tsx scripts/index-organizations.ts --all      # re-index everything
 *
 * Safe to re-run: by default skips rows that already have a non-null embedding.
 */

import { eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { embedBatch } from "../src/lib/services/embedding-service";

const PAGE_SIZE = 500;
const EMBED_BATCH = 32;

type OrgRow = {
  id: string;
  name: string;
  industry: string | null;
  description: string | null;
};

function buildText(row: OrgRow): string {
  return [row.name, row.industry, row.description]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" — ");
}

async function fetchPage(opts: {
  reindexAll: boolean;
  offset: number;
}): Promise<OrgRow[]> {
  const base = db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      industry: schema.organizations.industry,
      description: schema.organizations.description,
    })
    .from(schema.organizations);

  const query = opts.reindexAll
    ? base
    : base.where(isNull(schema.organizations.embedding));

  return await query.limit(PAGE_SIZE).offset(opts.offset);
}

async function main() {
  const reindexAll = process.argv.includes("--all");
  console.log(
    `[index-organizations] mode=${reindexAll ? "ALL" : "MISSING ONLY"} pageSize=${PAGE_SIZE} embedBatch=${EMBED_BATCH}`,
  );

  let offset = 0;
  let totalUpdated = 0;
  let batchNo = 0;
  const startedAt = Date.now();

  // For "missing only" mode we don't advance offset, because each batch
  // removes its rows from the result set. For "all" mode we do.
  while (true) {
    const page = await fetchPage({
      reindexAll,
      offset: reindexAll ? offset : 0,
    });
    if (page.length === 0) break;

    for (let i = 0; i < page.length; i += EMBED_BATCH) {
      batchNo++;
      const slice = page.slice(i, i + EMBED_BATCH);
      const texts = slice.map(buildText);
      const vectors = await embedBatch(texts);

      // One UPDATE per row — Postgres handles this fine at 32/batch. If you
      // want to push throughput further, wrap in a tx and consider UNNEST.
      await Promise.all(
        slice.map((row, idx) =>
          db
            .update(schema.organizations)
            .set({ embedding: vectors[idx] })
            .where(eq(schema.organizations.id, row.id)),
        ),
      );
      totalUpdated += slice.length;

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[index-organizations] batch=${batchNo} updated=${totalUpdated} elapsed=${elapsed}s`,
      );
    }

    if (reindexAll) {
      offset += page.length;
      if (page.length < PAGE_SIZE) break;
    } else {
      // We just embedded everything in this page; loop will re-query for
      // the next NULL-embedding window.
      if (page.length < PAGE_SIZE) break;
    }
  }

  // Refresh pg statistics so the planner uses the HNSW index.
  await db.execute(sql`ANALYZE organizations`);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[index-organizations] done. total_updated=${totalUpdated} elapsed=${elapsed}s`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[index-organizations] failed:", err);
    process.exit(1);
  });
