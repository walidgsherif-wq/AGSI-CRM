// Brand color palette — single source of truth for hex strings.
//
// Tailwind classes (`text-agsi-navy`, `bg-rag-red`, etc.) are the
// preferred way to reference these in JSX. tailwind.config.ts imports
// from this file, so the Tailwind tokens and the runtime constants
// can never drift.
//
// This module is also imported directly for the places where a
// real hex string is required:
//   - Recharts (chart fills, strokes, axis colours)
//   - @react-pdf/renderer (PDF reports — no Tailwind)
//   - Leaflet (heat-map cell fills, marker colours)
//   - Inline SVGs in chart components
//
// Pure constants only — no React, no Next imports — so this stays
// safe to evaluate at Tailwind-config build time.

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

/**
 * Categorical chart series — used when a Recharts panel renders an
 * arbitrary number of named series and we need a stable, brand-aligned
 * rotation. Ordered by visual contrast so adjacent series are easy to
 * tell apart.
 *
 * Index access: `CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length]`.
 */
export const CATEGORICAL_SERIES = [
  AGSI.accent,
  AGSI.navy,
  AGSI.green,
  AGSI.gold,
  AGSI.purple,
  AGSI.blue,
  RAG.amber,
  AGSI.darkGray,
] as const;

/**
 * Status → hex map. Keyed by the strings used elsewhere for engagement
 * buckets and RAG variants, so callers can write `STATUS_COLOUR[bucket]`
 * directly. Includes plain `red` / `amber` / `green` aliases.
 */
export const STATUS_COLOUR = {
  hot:     AGSI.green,
  warm:    AGSI.accent,
  cooling: RAG.amber,
  cold:    RAG.red,
  never:   AGSI.midGray,
  red:     RAG.red,
  amber:   RAG.amber,
  green:   RAG.green,
} as const;

export type StatusKey = keyof typeof STATUS_COLOUR;
