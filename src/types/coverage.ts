// Shared types + constants for the coverage radar. Lives outside the
// 'use server' actions file because Next.js 14 forbids non-function
// exports from a server-actions module.

import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export type ValueBand = 'all' | 'gt_100m' | 'gt_500m' | 'gt_1b';

export type CoverageRow = {
  type: keyof typeof COMPANY_TYPE_LABEL;
  label: string;
  numerator: number;
  denominator: number;
  coverage_pct: number;
};

// Spokes shown on the radar — exclude 'other' as a catch-all bucket.
export const SPOKE_TYPES = [
  'developer',
  'design_consultant',
  'main_contractor',
  'mep_consultant',
  'mep_contractor',
  'authority',
  'society',
] as const;

export type SpokeType = (typeof SPOKE_TYPES)[number];

export const BAND_THRESHOLD: Record<ValueBand, number | null> = {
  all: null,
  gt_100m: 100_000_000,
  gt_500m: 500_000_000,
  gt_1b: 1_000_000_000,
};
