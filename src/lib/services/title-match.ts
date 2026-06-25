/**
 * Title normalization + fuzzy match scoring (Champ Harbinger v2 spec, Section 4).
 *
 * Discovery returns people whose titles rarely match the requested wording
 * exactly: "Head of Treasury", "Treasury Lead", and "VP, Treasury" should all
 * satisfy a "treasury decision maker" intent. This normalizes a title into a
 * (seniority, functions) shape and scores a candidate title against the
 * requested title(s) on that basis.
 *
 * The maps below are intentionally simple and EDITABLE — adding a synonym is a
 * one-line change. No model call: this is cheap, deterministic, and unit-tested.
 */

export type Seniority =
  | "c_level"
  | "vp"
  | "head"
  | "director"
  | "manager"
  | "senior"
  | "ic"
  | "unknown";

// Higher = more senior. Used for seniority-proximity scoring.
const SENIORITY_RANK: Record<Seniority, number> = {
  c_level: 6,
  vp: 5,
  head: 4,
  director: 3,
  manager: 2,
  senior: 1,
  ic: 0,
  unknown: -1,
};

// First match wins (ordered most-senior-first). Editable.
const SENIORITY_PATTERNS: ReadonlyArray<readonly [RegExp, Seniority]> = [
  [
    /\b(c[efimotr]o|ciso|chief|founder|co-?founder|president|owner|partner|managing director|gm|general manager)\b/i,
    "c_level",
  ],
  [/\b(s?vp|evp|vice[-\s]?president)\b/i, "vp"],
  [/\bhead\b/i, "head"],
  [/\bdirector\b/i, "director"],
  [/\b(manager|mgr|lead)\b/i, "manager"],
  [/\b(senior|sr\.?|principal|staff)\b/i, "senior"],
];

// Function keyword → canonical function. Editable. A title can map to several.
const FUNCTION_KEYWORDS: Record<string, string[]> = {
  finance: ["finance", "financial", "fp&a", "controller", "accounting", "cfo"],
  treasury: ["treasury", "treasurer"],
  engineering: [
    "engineering",
    "engineer",
    "developer",
    "software",
    "technical",
    "cto",
    "devops",
    "infrastructure",
    "platform",
    "architect",
  ],
  sales: [
    "sales",
    "revenue",
    "account executive",
    "business development",
    "bdr",
    "sdr",
    "cro",
    "go-to-market",
    "gtm",
  ],
  marketing: ["marketing", "growth", "demand gen", "brand", "content", "cmo"],
  product: ["product", "cpo"],
  operations: ["operations", "ops", "coo"],
  people: [
    "people",
    "talent",
    "hr",
    "human resources",
    "recruiting",
    "recruiter",
  ],
  data: ["data", "analytics", "machine learning", "ml", "ai"],
  it: ["it", "information technology", "security", "ciso", "cio"],
  legal: ["legal", "counsel", "compliance", "general counsel"],
  procurement: ["procurement", "purchasing", "sourcing"],
  executive: ["ceo", "founder", "president", "owner"],
};

export interface NormalizedTitle {
  seniority: Seniority;
  functions: string[];
}

function lc(s: string): string {
  return s.toLowerCase();
}

/** Normalize a job title into a (seniority, functions) shape. */
export function normalizeTitle(
  title: string | null | undefined,
): NormalizedTitle {
  const t = lc((title ?? "").trim());
  if (!t) return { seniority: "unknown", functions: [] };

  let seniority: Seniority = "ic";
  for (const [re, level] of SENIORITY_PATTERNS) {
    if (re.test(t)) {
      seniority = level;
      break;
    }
  }

  const functions: string[] = [];
  for (const [fn, keywords] of Object.entries(FUNCTION_KEYWORDS)) {
    if (keywords.some((kw) => t.includes(kw))) functions.push(fn);
  }

  return { seniority, functions };
}

function tokenOverlap(a: string, b: string): number {
  const stop = new Set(["of", "the", "and", "for", "to", "a", "an", "&"]);
  const toks = (s: string) =>
    new Set(
      lc(s)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !stop.has(w)),
    );
  const ta = toks(a);
  const tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Score how well a candidate's title matches a requested title, in [0, 1].
 *
 * Function match is the gate (same function family → strong match), then
 * seniority proximity tunes it. Titles that don't map to a known function fall
 * back to token overlap so nothing is lost.
 */
export function scoreTitleMatch(
  candidateTitle: string | null | undefined,
  requestedTitle: string,
): number {
  const cand = normalizeTitle(candidateTitle);
  const req = normalizeTitle(requestedTitle);

  const sharedFn = cand.functions.filter((f) => req.functions.includes(f));

  if (sharedFn.length > 0) {
    // Same function family. Seniority proximity scales 0.7..1.0.
    let seniorityFactor = 1;
    if (
      cand.seniority !== "unknown" &&
      req.seniority !== "unknown" &&
      req.seniority !== "ic"
    ) {
      const dist = Math.abs(
        SENIORITY_RANK[cand.seniority] - SENIORITY_RANK[req.seniority],
      );
      seniorityFactor = Math.max(0, 1 - dist / 6); // 0 distance → 1, far → 0
    }
    return 0.7 + 0.3 * seniorityFactor;
  }

  // Both titles map to a KNOWN but different function (e.g. Engineering vs
  // Sales) — a genuine mismatch. Don't let a shared seniority word ("VP") leak
  // a token-overlap score.
  if (cand.functions.length > 0 && req.functions.length > 0) return 0;

  // One/both titles don't map to a known function — fall back to literal token
  // overlap (handles niche titles not in the map). Capped below the function
  // band.
  return Math.min(0.6, tokenOverlap(candidateTitle ?? "", requestedTitle));
}

/** Best score of a candidate title against any of the requested titles. */
export function bestTitleScore(
  candidateTitle: string | null | undefined,
  requestedTitles: string[],
): number {
  if (!requestedTitles || requestedTitles.length === 0) return 0;
  let best = 0;
  for (const req of requestedTitles) {
    const s = scoreTitleMatch(candidateTitle, req);
    if (s > best) best = s;
    if (best >= 1) break;
  }
  return best;
}
