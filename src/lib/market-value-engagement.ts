// Types + constants for the market-value engagement panel. Lives
// outside the 'use server' actions file because Next.js 14 forbids
// non-function exports from server-actions modules.

export type MarketValueBand = 'hot' | 'warm' | 'cooling' | 'older';

export const BAND_LABEL: Record<MarketValueBand, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cooling: 'Cooling',
  older: 'Older',
};

export const BAND_SUBLABEL: Record<MarketValueBand, string> = {
  hot: '≤30d',
  warm: '30–90d',
  cooling: '90–180d',
  older: '>180d',
};

// Sequential green ramp (matches temperature-board tone).
export const BAND_COLOR: Record<MarketValueBand, string> = {
  hot: '#0a663c',
  warm: '#3f8f6b',
  cooling: '#7cb094',
  older: '#c5d5cd',
};

export type MarketValueHeadline = {
  total_market_value: number;
  engaged_value: number;
  unengaged_value: number;
  live_project_count: number;
  value_known_count: number;
  engaged_project_count: number;
  engaged_company_count: number;
};

export type MarketValueColdRow = {
  band: MarketValueBand;
  value: number;
  project_count: number;
};

export type MarketValueWhitespaceRow = {
  id: string;
  name: string;
  value_aed: number;
  stage: string;
  city: string | null;
  sector: string | null;
};

export type MarketValueParetoRow = {
  top_n: number;
  cum_value: number;
  engaged_count: number;
  target_count: number;
};

export type MarketValueTopUnengagedRow = {
  id: string;
  canonical_name: string;
  company_type: string;
  associated_value: number;
  rn: number;
};

export type MarketValueEngagement = {
  headline: MarketValueHeadline;
  cold_split: MarketValueColdRow[];
  whitespace: MarketValueWhitespaceRow[];
  pareto: MarketValueParetoRow[];
  top_unengaged: MarketValueTopUnengagedRow[];
  /** Applied sphere universe (may have fallen back from 'sphere'
   *  to 'full' when sphere_members is empty). */
  universe: 'sphere' | 'full';
  /** True when caller asked for sphere but sphere_members is empty. */
  sphereEmpty: boolean;
};

/** Compact AED formatter — 12.3M / 456M / 1.2B. Keeps tiles legible. */
export function formatAedCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return `AED ${(n / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `AED ${(n / 1_000_000).toFixed(0)}M`;
  }
  if (abs >= 1_000) {
    return `AED ${(n / 1_000).toFixed(0)}K`;
  }
  return `AED ${n.toFixed(0)}`;
}

export function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}
