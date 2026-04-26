// Company-name normalisation for the BNC resolver.
// - Lowercase, collapse whitespace
// - Strip common suffixes (LLC, PJSC, FZE, FZCO, JSC, etc.) so
//   "Acme Holdings LLC" and "Acme Holdings" hash to the same fuzzy token
// - Strip leading/trailing punctuation
//
// IMPORTANT: this is for matching only. The original raw cell value is
// preserved on companies.aliases so future uploads can fuzzy-match either
// form.

const SUFFIXES = [
  'llc',
  'l.l.c',
  'l.l.c.',
  'pjsc',
  'p.j.s.c',
  'fzc',
  'fzco',
  'fze',
  'jsc',
  'co',
  'co.',
  'corp',
  'corp.',
  'inc',
  'inc.',
  'ltd',
  'limited',
  'ltd.',
  'group',
  'holdings',
  'establishment',
  'est',
  'est.',
];

const SUFFIX_RE = new RegExp(
  '\\s+(?:' + SUFFIXES.map((s) => s.replace(/\./g, '\\.')).join('|') + ')\\s*$',
  'i',
);

/** Lowercase, single-space, suffix-stripped, punctuation-trimmed. */
export function normaliseCompanyName(raw: string): string {
  let s = raw.toLowerCase().normalize('NFKC');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s.,;:'"()-]+|[\s.,;:'"()-]+$/g, '');
  // Strip suffix iteratively (e.g. "Foo Holdings LLC" → "Foo")
  let prev: string;
  do {
    prev = s;
    s = s.replace(SUFFIX_RE, '').trim();
  } while (s !== prev && s.length > 0);
  return s;
}

/** Title-case the original token for storage. We keep the user's casing
 *  as-is — only trim and collapse internal whitespace. */
export function tidyCompanyName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
