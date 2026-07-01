// Shared types + constants for the engagement-temperature board.
// Lives outside `src/server/actions/` because Next.js `'use server'`
// files may only export async functions — const arrays / objects
// belong in a plain module.

export type EngagementMeasure = 'companies' | 'events';

export const ENGAGEMENT_TYPE_ORDER = [
  'developer',
  'design_consultant',
  'main_contractor',
  'mep_consultant',
  'mep_contractor',
  'authority',
  'society',
] as const;

export type EngagementRowType = (typeof ENGAGEMENT_TYPE_ORDER)[number];

export const ENGAGEMENT_TYPE_LABEL: Record<EngagementRowType, string> = {
  developer: 'Developer',
  design_consultant: 'Design consultant',
  main_contractor: 'Main contractor',
  mep_consultant: 'MEP consultant',
  mep_contractor: 'MEP contractor',
  authority: 'Authority',
  society: 'Society',
};

/**
 * Order the RPC uses for its bands. The 4th slot ("tail") relabels
 * per measure — "Cold / none" in companies mode, "Older (>180d)" in
 * events mode — but the semantic (right-most = coldest) stays.
 */
export const BAND_ORDER = ['hot', 'warm', 'cooling', 'tail'] as const;

export type Band = (typeof BAND_ORDER)[number];

export type EngagementBreadth = {
  total: number;
  engaged: number;
  active: number;
  cooling: number;
  untouched: number;
};

export type EngagementGrid = Record<EngagementRowType, Record<Band, number>>;

export type EngagementTemperature = {
  measure: EngagementMeasure;
  breadth: EngagementBreadth;
  grid: EngagementGrid;
  /** Max cell value across the grid — the UI normalises the
   *  sequential ramp against it. Zero when the grid is empty. */
  cellMax: number;
};

export function emptyEngagementGrid(): EngagementGrid {
  const out = {} as EngagementGrid;
  for (const t of ENGAGEMENT_TYPE_ORDER) {
    out[t] = { hot: 0, warm: 0, cooling: 0, tail: 0 };
  }
  return out;
}

/**
 * Map the RPC's raw band string to the UI's ordered band index.
 * The RPC emits 'cold_or_none' in companies mode and 'older' in
 * events mode — both roll up into the 4th slot ('tail').
 */
export function normaliseBand(raw: string): Band | null {
  if (raw === 'hot') return 'hot';
  if (raw === 'warm') return 'warm';
  if (raw === 'cooling') return 'cooling';
  if (raw === 'cold_or_none' || raw === 'older') return 'tail';
  return null;
}
