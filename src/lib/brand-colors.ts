// Brand color palette — single source of truth for hex strings.
//
// Tailwind classes (`text-agsi-navy`, `bg-rag-red`, etc.) are the
// preferred way to reference these in JSX. This module exists for the
// places where a real hex string is required:
//
//   - Recharts (chart fills, strokes, axis colours)
//   - @react-pdf/renderer (PDF reports — no Tailwind)
//   - Leaflet (heat-map cell fills, marker colours)
//   - Inline SVGs in chart components
//
// Keep in sync with tailwind.config.ts theme.extend.colors.

export const AGSI = {
  navy:       '#1A2A4A',
  blue:       '#1F3C6E',
  accent:     '#2B6CB0',
  purple:     '#6B4F9E',
  green:      '#2E7D52',
  gold:       '#D4AF37',
  offWhite:   '#F7F9FC',
  lightGray:  '#E8EDF4',
  midGray:    '#C5CDD8',
  darkGray:   '#4A5568',
} as const;

export const RAG = {
  red:   '#C53030',
  amber: '#DD8E2A',
  green: '#2E7D52',
} as const;

/**
 * Per-level palette (§15 of the prompt).
 *
 *   L0 = midGray, L1 = accent, L2 = blue, L3 = green,
 *   L4 = purple,  L5 = gold
 */
export const LEVEL_COLOURS = {
  L0: AGSI.midGray,
  L1: AGSI.accent,
  L2: AGSI.blue,
  L3: AGSI.green,
  L4: AGSI.purple,
  L5: AGSI.gold,
} as const;
