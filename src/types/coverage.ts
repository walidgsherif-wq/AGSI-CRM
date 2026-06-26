// Shared types + constants for the coverage views. Lives outside the
// 'use server' actions file because Next.js 14 forbids non-function
// exports from a server-actions module.

import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export type ValueBand = 'all' | 'gt_100m' | 'gt_500m' | 'gt_1b';

export type MemberContribution = {
  member_id: string;
  full_name: string;
  /** Number of companies of THIS spoke type owned by this member. */
  count: number;
  /** count / type denominator * 100 — absolute share of universe. */
  share_pct: number;
};

export type CoverageRow = {
  type: keyof typeof COMPANY_TYPE_LABEL;
  label: string;
  /** Number of companies of this type the team has claimed (any owner). */
  numerator: number;
  /** Universe count — active companies of this type (band-filtered). */
  denominator: number;
  /** numerator / denominator * 100. */
  coverage_pct: number;
  /** Per-member breakdown — entries with count > 0 only, sorted by count desc. */
  by_member: MemberContribution[];
};

// Spokes shown on every coverage view — exclude 'other' as a catch-all.
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
