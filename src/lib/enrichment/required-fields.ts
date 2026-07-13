import { DEFAULT_REQUIRED_FIELDS } from "./orchestrator";

/**
 * Map the upload screen's "what a complete contact must have" options
 * (COMPLETENESS_OPTIONS in csv-mapping: work_email / linkedin / direct_dial /
 * seniority) onto the waterfall's canonical field names. This is the seam that
 * lets a rep define completeness on ingest (spec §3) and have it drive the
 * waterfall's accept gate (spec §5).
 */
const COMPLETENESS_TO_CANONICAL: Record<string, string> = {
  work_email: "email",
  linkedin: "linkedin",
  direct_dial: "phone",
  seniority: "seniority",
};

/**
 * Translate a campaign's chosen completeness options into the canonical
 * required-field list the orchestrator gates on. Unknown options are dropped;
 * when nothing maps, fall back to the engine default so a job always has a bar.
 */
export function canonicalRequiredFields(
  completenessOptions: string[],
): string[] {
  const out: string[] = [];
  for (const opt of completenessOptions) {
    const canonical = COMPLETENESS_TO_CANONICAL[opt];
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out.length > 0 ? out : [...DEFAULT_REQUIRED_FIELDS];
}
