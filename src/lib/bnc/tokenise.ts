// Multi-company cell tokenisation.
//
// BNC cells like "Acme LLC, Beta Designs (Beta Architects, Engineers) (Dubai)"
// must split on the comma between Acme and Beta — but NOT on the comma inside
// the "Beta Architects, Engineers" parenthetical. Naive split-on-comma would
// produce three tokens; we want two.
//
// Algorithm: walk the string, track parenthesis depth, only split on commas
// when depth = 0.
//
// We also extract parenthetical text as "aliases" — the next upload may use
// either form, so storing them on companies.aliases helps fuzzy matching.

import { tidyCompanyName } from './normalise';

export type CompanyToken = {
  /** Primary name with parentheses stripped. */
  name: string;
  /** Any parenthetical text found inside the original cell. */
  aliases: string[];
  /** The original cell substring before any cleanup. */
  raw: string;
};

const SKIP_VALUES = new Set([
  '',
  '-',
  '—',
  'n/a',
  'na',
  'none',
  'tba',
  'tbd',
  'not yet awarded',
  'not awarded',
  'not appointed',
  'not yet appointed',
  'unknown',
]);

function shouldSkip(s: string): boolean {
  return SKIP_VALUES.has(s.toLowerCase().trim());
}

/** Split a multi-company cell on top-level commas. */
function splitTopLevel(cell: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of cell) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Strip ALL `(...)` segments out of a name and return both the cleaned name
 *  and the bracketed content as alias candidates. */
function extractAliases(token: string): { name: string; aliases: string[] } {
  const aliases: string[] = [];
  const cleaned = token.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) aliases.push(trimmed);
    return ' ';
  });
  return {
    name: tidyCompanyName(cleaned),
    aliases: aliases.map((a) => tidyCompanyName(a)).filter((a) => a.length > 0),
  };
}

/** Tokenise a multi-company cell into individual companies. */
export function tokeniseCompanyCell(cell: string | null | undefined): CompanyToken[] {
  if (!cell) return [];
  const tokens = splitTopLevel(cell)
    .map((t) => t.trim())
    .filter((t) => !shouldSkip(t));

  const out: CompanyToken[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const { name, aliases } = extractAliases(raw);
    if (!name || shouldSkip(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, aliases, raw });
  }
  return out;
}

/** Split a parallel "Phone" / "Email" / "Key Contact" cell whose entries are
 *  index-aligned with a company cell. Returns one entry per top-level comma. */
export function splitParallel(cell: string | null | undefined): string[] {
  if (!cell) return [];
  return splitTopLevel(cell).map((s) => s.trim());
}

/** Pull the i-th value from a parallel cell, returning null if missing or
 *  one of the skip values. */
export function nthOrNull(cell: string | null | undefined, i: number): string | null {
  const parts = splitParallel(cell);
  const v = parts[i];
  if (v === undefined) return null;
  if (shouldSkip(v)) return null;
  return v;
}
