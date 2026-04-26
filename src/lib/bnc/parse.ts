// XLSX parser for BNC project exports.
// Auto-detects the header row by scanning the first 10 rows for "Reference Number".
// Tolerant of column reordering — looks up by header name, not position.

import * as XLSX from 'xlsx';

export type RawRow = Record<string, string | null>;

export type ParseResult = {
  headers: string[];
  rows: RawRow[];
  /** 0-indexed row of the header line within the sheet. */
  headerRowIndex: number;
};

const HEADER_HINTS = ['reference number', 'project name', 'reference no', 'project ref'];

function looksLikeHeader(row: unknown[]): boolean {
  const lc = row
    .map((v) => (typeof v === 'string' ? v.toLowerCase().trim() : ''))
    .filter(Boolean);
  return HEADER_HINTS.some((hint) => lc.some((cell) => cell.includes(hint)));
}

/** Convert a sheet cell into a string (or null). Numbers + dates round-trip
 *  to their string form so the downstream parser can apply column-specific
 *  parsing (number stripping, date format detection). */
function cellToString(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    // ISO date (UTC) — downstream code re-parses with TZ awareness.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Excel returns numbers for both numeric values and dates. SheetJS already
    // converted serial dates to JS Date when cellDates: true (we pass that
    // below), so any remaining number is a real number.
    return String(v);
  }
  return String(v).trim();
}

export function parseBncWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Workbook has no sheets.');
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  // Find header row in first 10
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (looksLikeHeader(rows[i] ?? [])) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error(
      'Could not locate header row. Expected a row containing "Reference Number" or "Project Name" within the first 10 rows.',
    );
  }

  const headerRaw = rows[headerRowIndex] ?? [];
  const headers = headerRaw.map((h) => (typeof h === 'string' ? h.trim() : String(h ?? '').trim()));

  const dataRows: RawRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((v) => v === null || v === '')) continue;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = cellToString(row[c]);
    }
    dataRows.push(obj);
  }

  return { headers, rows: dataRows, headerRowIndex };
}

/** Helper: pick the first non-null value from a list of column-name aliases.
 *  Robust against minor BNC column renames between exports. */
export function pickColumn(row: RawRow, aliases: string[]): string | null {
  for (const a of aliases) {
    if (a in row && row[a] !== null && row[a] !== '') return row[a];
    // Case-insensitive fallback
    const found = Object.keys(row).find((k) => k.toLowerCase() === a.toLowerCase());
    if (found && row[found] !== null && row[found] !== '') return row[found];
  }
  return null;
}

/** Parse a BNC value cell that may have thousand separators. */
export function parseNumber(s: string | null): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t || t.toUpperCase() === 'N/A' || t === '-') return null;
  const cleaned = t.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse a date that may be in YYYY-MM-DD or DD/MM/YY(YY) format.
 *  Returns ISO date string (YYYY-MM-DD) or null. */
export function parseDate(s: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t || t.toUpperCase() === 'N/A') return null;

  // ISO YYYY-MM-DD (most common after SheetJS cellDates conversion)
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // ISO with time (T separator)
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD/MM/YY or DD/MM/YYYY (BNC's "Updated Date" column)
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) {
      const n = parseInt(yyyy, 10);
      yyyy = (n < 50 ? 2000 + n : 1900 + n).toString();
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}
