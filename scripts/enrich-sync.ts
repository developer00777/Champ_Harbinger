/**
 * CLI: run the owned-master <-> LakeB2B sync pass. Deferred no-op in SP1 unless
 * LAKEB2B_MASTER_DSN is set. Usage: pnpm enrich:sync
 */
import { syncWithLakeB2BMaster } from "@/lib/enrichment/master-sync";

async function main() {
  const result = await syncWithLakeB2BMaster();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("enrich:sync failed:", err);
  process.exit(1);
});
