/**
 * Dependency-free report exports. CSV/JSON serialization is pure (and tested);
 * the download + print helpers touch the DOM and run client-side only. PDF is
 * produced via the browser's print dialog against a print-styled report — no
 * heavyweight PDF library, consistent with the hand-rolled-SVG chart approach.
 */

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvCell>;

/** Escape a single CSV field per RFC 4180 (quote when it contains ,"\n). */
export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialize rows to CSV. Columns default to the union of keys in row order of
 * first appearance, so callers can pass heterogeneous rows safely.
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  const cols = columns ?? deriveColumns(rows);
  const header = cols.map(csvField).join(",");
  const body = rows.map((row) => cols.map((c) => csvField(row[c])).join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}

function deriveColumns(rows: CsvRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/** Trigger a browser download of arbitrary text content. */
export function downloadText(filename: string, content: string, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: CsvRow[], columns?: string[]): void {
  downloadText(filename, toCsv(rows, columns), "text/csv");
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

/** Open the print dialog so the user can save the current report as a PDF. */
export function printReport(): void {
  if (typeof window !== "undefined") window.print();
}
