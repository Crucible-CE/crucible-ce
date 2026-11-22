// The one CSV writer for server-generated exports.
//
// Every cell is quoted (embedded quotes doubled), and a cell that a
// spreadsheet would treat as a formula — first character = + - @ TAB or CR —
// is prefixed with a single quote so Excel / Sheets / LibreOffice show it as
// text instead of evaluating it (CSV / formula injection, OWASP).

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** One CSV cell: formula-neutralised and quoted. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows -> CSV text (CRLF line endings, RFC 4180). */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
