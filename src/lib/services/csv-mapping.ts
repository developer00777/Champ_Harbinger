/**
 * Champ Sets ingest — column mapping + validation (v2 spec, Section 3).
 *
 * The Upload screen accepts an `.xlsx`/CSV from Champ Sets in one of two shapes:
 *
 *   - "companies": one company per row (+ the target titles we want there). We
 *     have the accounts, we need to find the right people.
 *   - "contacts":  one person per row (name + company, maybe email/LinkedIn). We
 *     already have the names, we just need enrichment.
 *
 * This module is the pure, deterministic core behind that screen: auto-detect a
 * header→canonical-field mapping, let the rep override it, then apply it to the
 * rows (normalizing domains, de-duping within the file, flagging blanks). It has
 * NO imports so it runs identically in the browser (live preview) and on the
 * server (the import route), and it is unit-tested.
 */

export type IngestShape = "companies" | "contacts";

export type CompanyField =
  | "name"
  | "domain"
  | "url"
  | "industry"
  | "location"
  | "description"
  | "targetTitles";

export type ContactField =
  | "personName"
  | "company"
  | "domain"
  | "title"
  | "email"
  | "linkedin"
  | "location";

export type CanonicalField = CompanyField | ContactField;

export interface FieldDef {
  field: CanonicalField;
  label: string;
  /** Lower-cased header synonyms that auto-map to this field. */
  aliases: string[];
  required?: boolean;
}

// First match wins; order only matters within a shape for the auto-mapper.
const COMPANY_FIELDS: FieldDef[] = [
  {
    field: "name",
    label: "Company",
    required: true,
    aliases: [
      "name",
      "company",
      "company name",
      "company_name",
      "organization",
      "organisation",
      "account",
      "account name",
    ],
  },
  {
    field: "targetTitles",
    label: "Target titles",
    aliases: [
      "target titles",
      "target_titles",
      "titles",
      "target title",
      "roles",
      "target roles",
      "titles to reach",
      "persona",
      "personas",
    ],
  },
  {
    field: "domain",
    label: "Domain",
    aliases: ["domain", "website", "website url", "web", "site", "url domain"],
  },
  {
    field: "url",
    label: "Website URL",
    aliases: ["url", "link", "homepage", "web address"],
  },
  {
    field: "industry",
    label: "Industry",
    aliases: ["industry", "sector", "vertical"],
  },
  {
    field: "location",
    label: "Location",
    aliases: [
      "location",
      "city",
      "country",
      "hq",
      "headquarters",
      "region",
      "geography",
      "geo",
    ],
  },
  {
    field: "description",
    label: "Description",
    aliases: ["description", "about", "summary", "overview"],
  },
];

const CONTACT_FIELDS: FieldDef[] = [
  {
    field: "personName",
    label: "Full name",
    required: true,
    aliases: [
      "name",
      "full name",
      "full_name",
      "contact",
      "contact name",
      "person",
      "person name",
      "lead name",
    ],
  },
  {
    field: "company",
    label: "Company",
    required: true,
    aliases: [
      "company",
      "company name",
      "organization",
      "organisation",
      "account",
      "employer",
    ],
  },
  {
    field: "title",
    label: "Title",
    aliases: ["title", "job title", "role", "position", "designation"],
  },
  {
    field: "email",
    label: "Email",
    aliases: [
      "email",
      "work email",
      "email address",
      "e-mail",
      "mail",
      "business email",
    ],
  },
  {
    field: "linkedin",
    label: "LinkedIn",
    aliases: [
      "linkedin",
      "linkedin url",
      "linkedin profile",
      "li url",
      "profile",
      "profile url",
    ],
  },
  {
    field: "domain",
    label: "Domain",
    aliases: ["domain", "website", "site", "company domain"],
  },
  {
    field: "location",
    label: "Location",
    aliases: ["location", "city", "country", "region", "geography"],
  },
];

export function fieldDefs(shape: IngestShape): FieldDef[] {
  return shape === "companies" ? COMPANY_FIELDS : CONTACT_FIELDS;
}

function requiredFieldsOf(shape: IngestShape): CanonicalField[] {
  return fieldDefs(shape)
    .filter((f) => f.required)
    .map((f) => f.field);
}

// ── Required-field set ("what a complete contact must have", per-job) ─────────

export type CompletenessField =
  | "work_email"
  | "linkedin"
  | "direct_dial"
  | "seniority";

export const COMPLETENESS_OPTIONS: {
  field: CompletenessField;
  label: string;
}[] = [
  { field: "work_email", label: "Work email" },
  { field: "linkedin", label: "LinkedIn" },
  { field: "direct_dial", label: "Direct dial" },
  { field: "seniority", label: "Seniority" },
];

// ── Normalization helpers (pure) ─────────────────────────────────────────────

/** Lightweight domain normalize — no URL/DNS deps so this runs client-side. */
export function normalizeDomainLite(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "");
}

function domainFromUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return normalizeDomainLite(u.hostname);
  } catch {
    return null;
  }
}

/** Split a "CFO, VP Finance; Head of Treasury" cell into discrete titles. */
export function splitTitles(raw: string): string[] {
  return raw
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Auto-mapping ─────────────────────────────────────────────────────────────

/**
 * Best-effort header → canonical-field mapping. Each header maps to at most one
 * field, and each field is claimed by at most one header (first wins). If the
 * required key field is still unclaimed, the first column is assumed to be it.
 */
export function autoDetectMapping(
  headers: string[],
  shape: IngestShape,
): (CanonicalField | null)[] {
  const defs = fieldDefs(shape);
  const claimed = new Set<CanonicalField>();
  const mapping: (CanonicalField | null)[] = headers.map((h) => {
    const norm = h.toLowerCase().trim();
    for (const def of defs) {
      if (claimed.has(def.field)) continue;
      if (def.aliases.includes(norm)) {
        claimed.add(def.field);
        return def.field;
      }
    }
    return null;
  });

  // Fallback: the key field (Company / Full name) is what makes a row usable.
  const keyField = requiredFieldsOf(shape)[0];
  if (keyField && !claimed.has(keyField) && headers.length > 0) {
    const firstFree = mapping.findIndex((m) => m === null);
    const idx = firstFree === -1 ? 0 : firstFree;
    mapping[idx] = keyField;
  }

  return mapping;
}

/** Which required fields are not yet covered by the mapping. */
export function missingRequiredFields(
  mapping: (CanonicalField | null)[],
  shape: IngestShape,
): CanonicalField[] {
  const present = new Set(mapping.filter((m): m is CanonicalField => !!m));
  return requiredFieldsOf(shape).filter((f) => !present.has(f));
}

// ── Apply mapping → typed rows ───────────────────────────────────────────────

export interface MappedCompany {
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  targetTitles: string[];
}

export interface MappedContact {
  name: string;
  company: string;
  domain: string | null;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  location: string | null;
}

export interface MappedResult {
  companies: MappedCompany[];
  contacts: MappedContact[];
  skipped: number; // rows dropped for missing the required key field
  duplicates: number; // rows dropped as in-file duplicates
}

function cell(
  row: string[],
  mapping: (CanonicalField | null)[],
  field: CanonicalField,
): string {
  const idx = mapping.indexOf(field);
  if (idx === -1) return "";
  return (row[idx] ?? "").trim();
}

export function applyMapping(
  headers: string[],
  rows: string[][],
  mapping: (CanonicalField | null)[],
  shape: IngestShape,
): MappedResult {
  void headers;
  const result: MappedResult = {
    companies: [],
    contacts: [],
    skipped: 0,
    duplicates: 0,
  };

  if (shape === "companies") {
    const seen = new Set<string>();
    for (const row of rows) {
      const name = cell(row, mapping, "name");
      if (!name) {
        result.skipped++;
        continue;
      }
      let domain = cell(row, mapping, "domain") || null;
      const url = cell(row, mapping, "url") || null;
      if (!domain && url) domain = domainFromUrl(url);
      if (domain) domain = normalizeDomainLite(domain);

      const dedupKey = domain ?? `name:${name.toLowerCase()}`;
      if (seen.has(dedupKey)) {
        result.duplicates++;
        continue;
      }
      seen.add(dedupKey);

      const titlesRaw = cell(row, mapping, "targetTitles");
      result.companies.push({
        name,
        domain,
        url: url ?? (domain ? `https://${domain}` : null),
        industry: cell(row, mapping, "industry") || null,
        location: cell(row, mapping, "location") || null,
        description: cell(row, mapping, "description") || null,
        targetTitles: titlesRaw ? splitTitles(titlesRaw) : [],
      });
    }
    return result;
  }

  // contacts shape
  const seen = new Set<string>();
  for (const row of rows) {
    const name = cell(row, mapping, "personName");
    const company = cell(row, mapping, "company");
    // A known contact needs at least a name and the company they're at.
    if (!name || !company) {
      result.skipped++;
      continue;
    }
    let domain = cell(row, mapping, "domain") || null;
    if (domain) domain = normalizeDomainLite(domain);
    const email = cell(row, mapping, "email") || null;
    const linkedin = cell(row, mapping, "linkedin") || null;

    const dedupKey =
      (email && `email:${email.toLowerCase()}`) ||
      (linkedin && `li:${linkedin.toLowerCase()}`) ||
      `nc:${name.toLowerCase()}@${company.toLowerCase()}`;
    if (seen.has(dedupKey)) {
      result.duplicates++;
      continue;
    }
    seen.add(dedupKey);

    result.contacts.push({
      name,
      company,
      domain,
      title: cell(row, mapping, "title") || null,
      email,
      linkedin,
      location: cell(row, mapping, "location") || null,
    });
  }
  return result;
}
