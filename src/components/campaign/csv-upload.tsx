"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import readXlsxFile from "read-excel-file/browser";

import { Button } from "@/components/ui/button";
import { Select, type SelectItemDef } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type CanonicalField,
  type CompletenessField,
  type IngestShape,
  applyMapping,
  autoDetectMapping,
  COMPLETENESS_OPTIONS,
  fieldDefs,
  missingRequiredFields,
} from "@/lib/services/csv-mapping";

interface CsvUploadProps {
  campaignId: string;
  onImported: () => void;
}

const IGNORE = "__ignore__";

const SHAPES: { value: IngestShape; label: string; hint: string }[] = [
  {
    value: "companies",
    label: "Companies",
    hint: "One company per row — we find the people",
  },
  {
    value: "contacts",
    label: "Known contacts",
    hint: "One person per row — we just enrich them",
  },
];

// ── CSV / Excel parsing (unchanged) ──────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (
      (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) &&
      !inQuotes
    ) {
      lines.push(current);
      current = "";
      if (ch === "\r") i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (ch === "," && !q) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const headers = splitRow(lines[0]);
  const rows = lines
    .slice(1)
    .map(splitRow)
    .filter((r) => r.some((c) => c));

  return { headers, rows };
}

// ── Component ────────────────────────────────────────────────────────────────

export function CsvUpload({ campaignId, onImported }: CsvUploadProps) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState<IngestShape>("companies");
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(CanonicalField | null)[]>([]);
  const [requiredFields, setRequiredFields] = useState<CompletenessField[]>([
    "work_email",
    "linkedin",
  ]);
  const [budgetCap, setBudgetCap] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRawHeaders([]);
    setRawRows([]);
    setMapping([]);
    setResult(null);
    setError(null);
    setImporting(false);
  };

  // Re-derive the typed rows + preview whenever the mapping or shape changes.
  const mapped = useMemo(
    () => applyMapping(rawHeaders, rawRows, mapping, shape),
    [rawHeaders, rawRows, mapping, shape],
  );
  const missing = useMemo(
    () => missingRequiredFields(mapping, shape),
    [mapping, shape],
  );

  const rowCount =
    shape === "companies" ? mapped.companies.length : mapped.contacts.length;

  const finalize = useCallback(
    (h: string[], rows: string[][], nextShape: IngestShape) => {
      if (rows.length === 0) {
        setError("No data rows found in the file.");
        return;
      }
      setRawHeaders(h);
      setRawRows(rows);
      setMapping(autoDetectMapping(h, nextShape));
    },
    [],
  );

  const handleFile = useCallback(
    (file: File) => {
      reset();
      setOpen(true);
      const isExcel = /\.xlsx?$/i.test(file.name);
      if (isExcel) {
        readXlsxFile(file)
          .then((sheets) => {
            const data = (sheets[0]?.data ?? []) as unknown[][];
            const matrix: string[][] = data.map((row) =>
              row.map((cell) => (cell == null ? "" : String(cell).trim())),
            );
            const [h = [], ...rows] = matrix;
            finalize(
              h,
              rows.filter((r) => r.some((c) => c)),
              shape,
            );
          })
          .catch((err: unknown) => {
            console.error("[xlsx] parse failed", err);
            const msg = err instanceof Error ? err.message : String(err);
            setError(
              `Could not read the Excel file (${msg}). It must be a modern .xlsx — re-save legacy .xls files as .xlsx, or export as CSV.`,
            );
          });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const { headers: h, rows } = parseCSV(e.target?.result as string);
        finalize(h, rows, shape);
      };
      reader.readAsText(file);
    },
    [finalize, shape],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && /\.(csv|xlsx?)$/i.test(file.name)) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  // Switching shape after a file is loaded re-runs auto-mapping for that shape.
  const changeShape = (next: IngestShape) => {
    setShape(next);
    if (rawHeaders.length > 0) setMapping(autoDetectMapping(rawHeaders, next));
  };

  const setColumn = (index: number, value: string) => {
    setMapping((prev) => {
      const copy = [...prev];
      copy[index] = value === IGNORE ? null : (value as CanonicalField);
      return copy;
    });
  };

  const toggleRequired = (field: CompletenessField) => {
    setRequiredFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const budgetCapUsd = budgetCap.trim()
        ? Number.parseFloat(budgetCap.trim())
        : null;
      const payload =
        shape === "companies"
          ? { companies: mapped.companies }
          : { contacts: mapped.contacts };
      const res = await fetch("/api/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          shape,
          requiredFields,
          budgetCapUsd:
            budgetCapUsd != null && Number.isFinite(budgetCapUsd)
              ? budgetCapUsd
              : null,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed.");
        return;
      }
      setResult({ imported: data.imported, skipped: data.skipped });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const fieldItems: SelectItemDef[] = [
    { value: IGNORE, label: "— Ignore —" },
    ...fieldDefs(shape).map((d) => ({
      value: d.field,
      label: d.required ? `${d.label} *` : d.label,
    })),
  ];

  const hasFile = rawHeaders.length > 0;
  const canImport = hasFile && rowCount > 0 && missing.length === 0;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        Import CSV / Excel
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from CSV or Excel</DialogTitle>
          </DialogHeader>

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {result ? (
            <div className="space-y-3">
              <div className="bg-muted rounded-md px-4 py-3 text-sm">
                <p>
                  <strong>{result.imported}</strong>{" "}
                  {shape === "companies" ? "companies" : "contacts"} imported
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({result.skipped} skipped as duplicates or invalid)
                    </span>
                  )}
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Shape toggle — companies vs known contacts */}
              <div>
                <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                  What is in this file?
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SHAPES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => changeShape(s.value)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        shape === s.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="font-medium">{s.label}</div>
                      <div className="text-muted-foreground text-xs">
                        {s.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {!hasFile ? (
                <div className="text-muted-foreground py-6 text-center text-sm">
                  Parsing file...
                </div>
              ) : (
                <>
                  {/* Column mapping — editable */}
                  <div>
                    <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                      Map columns ({rawRows.length} rows)
                    </div>
                    <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                      {rawHeaders.map((h, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span
                            className="text-muted-foreground w-28 shrink-0 truncate text-xs"
                            title={h}
                          >
                            {h || `Column ${i + 1}`}
                          </span>
                          <Select
                            value={mapping[i] ?? IGNORE}
                            onValueChange={(v) => setColumn(i, v)}
                            items={fieldItems}
                            triggerClassName="h-7"
                            aria-label={`Map column ${h || i + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                    {missing.length > 0 && (
                      <p className="text-destructive mt-1.5 text-xs">
                        Map a column to{" "}
                        {missing
                          .map(
                            (f) =>
                              fieldDefs(shape).find((d) => d.field === f)
                                ?.label ?? f,
                          )
                          .join(" and ")}{" "}
                        to continue.
                      </p>
                    )}
                  </div>

                  {/* Required-field set + per-job budget cap */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                        A complete contact must have
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {COMPLETENESS_OPTIONS.map((opt) => {
                          const on = requiredFields.includes(opt.field);
                          return (
                            <button
                              key={opt.field}
                              type="button"
                              onClick={() => toggleRequired(opt.field)}
                              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                on
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:bg-muted/50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="budget-cap"
                        className="text-muted-foreground mb-1.5 block text-xs font-medium"
                      >
                        Per-job budget cap (optional)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-sm">$</span>
                        <input
                          id="budget-cap"
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          placeholder="No cap"
                          value={budgetCap}
                          onChange={(e) => setBudgetCap(e.target.value)}
                          className="border-input bg-background focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-3"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="border-border overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-left text-xs font-medium">
                          {shape === "companies" ? (
                            <>
                              <th className="px-3 py-1.5">Name</th>
                              <th className="px-3 py-1.5">Domain</th>
                              <th className="px-3 py-1.5">Titles</th>
                              <th className="px-3 py-1.5">Location</th>
                            </>
                          ) : (
                            <>
                              <th className="px-3 py-1.5">Name</th>
                              <th className="px-3 py-1.5">Title</th>
                              <th className="px-3 py-1.5">Company</th>
                              <th className="px-3 py-1.5">Email</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {shape === "companies"
                          ? mapped.companies.slice(0, 5).map((c, i) => (
                              <tr key={i} className="border-border border-t">
                                <td className="px-3 py-1.5">{c.name}</td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.domain || "--"}
                                </td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.targetTitles.length
                                    ? c.targetTitles.join(", ")
                                    : "--"}
                                </td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.location || "--"}
                                </td>
                              </tr>
                            ))
                          : mapped.contacts.slice(0, 5).map((c, i) => (
                              <tr key={i} className="border-border border-t">
                                <td className="px-3 py-1.5">{c.name}</td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.title || "--"}
                                </td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.company}
                                </td>
                                <td className="text-muted-foreground px-3 py-1.5">
                                  {c.email || "--"}
                                </td>
                              </tr>
                            ))}
                      </tbody>
                    </table>
                    {rowCount > 5 && (
                      <div className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
                        + {rowCount - 5} more
                      </div>
                    )}
                    {rowCount === 0 && (
                      <div className="text-muted-foreground px-3 py-3 text-xs">
                        No valid rows with the current mapping.
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        reset();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleImport}
                      disabled={importing || !canImport}
                    >
                      {importing
                        ? "Importing..."
                        : `Import ${rowCount} ${
                            shape === "companies"
                              ? rowCount === 1
                                ? "company"
                                : "companies"
                              : rowCount === 1
                                ? "contact"
                                : "contacts"
                          }`}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
