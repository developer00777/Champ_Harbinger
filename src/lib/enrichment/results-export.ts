/**
 * Provenance-attached CSV export for the Results screen (spec §9 screen 4:
 * "export CSV + provenance"). Every canonical field ships with the value AND
 * where it came from — source, confidence, and whether it was verified — so a
 * downstream consumer can trust or re-check each cell.
 */

/** Canonical fields exported with full provenance, in a stable column order. */
export const PROVENANCE_FIELDS = [
  "email",
  "phone",
  "title",
  "seniority",
  "linkedin",
] as const;

export interface FieldCell {
  value: unknown;
  source: string;
  confidence: number;
  verified: boolean;
}

export interface ResultRecord {
  name: string | null;
  company: string | null;
  domain: string | null;
  status: string;
  completenessScore: number;
  confidenceScore: number;
  fields: Record<string, FieldCell>;
}

/** RFC 4180 cell escaping: quote when the value holds a comma, quote, or newline. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const IDENTITY_COLUMNS = [
  "name",
  "company",
  "domain",
  "status",
  "completeness",
  "confidence",
];

/** Header + one row per record; each field expands to value/source/confidence/verified. */
export function buildProvenanceCsv(records: ResultRecord[]): string {
  const header = [
    ...IDENTITY_COLUMNS,
    ...PROVENANCE_FIELDS.flatMap((f) => [
      f,
      `${f}_source`,
      `${f}_confidence`,
      `${f}_verified`,
    ]),
  ].join(",");

  const rows = records.map((rec) => {
    const cells: unknown[] = [
      rec.name,
      rec.company,
      rec.domain,
      rec.status,
      rec.completenessScore,
      rec.confidenceScore,
    ];
    for (const f of PROVENANCE_FIELDS) {
      const cell = rec.fields[f];
      if (cell) {
        cells.push(cell.value, cell.source, cell.confidence, cell.verified);
      } else {
        cells.push("", "", "", "");
      }
    }
    return cells.map(csvCell).join(",");
  });

  return [header, ...rows].join("\n");
}
