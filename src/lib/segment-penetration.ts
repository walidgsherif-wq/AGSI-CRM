import { LEVELS, type Level } from '@/types/domain';
import { SPOKE_TYPES, type SpokeType } from '@/types/coverage';

export { LEVELS, SPOKE_TYPES };
export type { Level, SpokeType };

/**
 * One row per stakeholder type. Total = universe (band-filtered);
 * unclaimed = owner_id IS NULL count; by_level = distribution over
 * CLAIMED companies (owner_id IS NOT NULL). The invariant
 * `unclaimed + sum(by_level) === total` is what makes the stacked
 * bar honest.
 */
export type SegmentPenetrationRow = {
  type: SpokeType;
  label: string;
  total: number;
  unclaimed: number;
  by_level: Record<Level, number>;
};

/**
 * Neutral gray for the unclaimed slice. Sequential blue ramp for
 * L0 → L5 — light on the left (fresh contact / lower depth), dark
 * on the right (strategic partnership). The ramp reads
 * light → dark as "shallower → deeper relationship" per the brief.
 *
 * Kept as HEX rather than Tailwind classes because a stacked bar
 * built from inline `width%` slices doesn't play well with class
 * generation at runtime, and centralising here keeps the legend
 * and the bar in lockstep.
 */
export const UNCLAIMED_COLOR = '#D8DBE0';

export const LEVEL_COLOR: Record<Level, string> = {
  L0: '#DBE7F5',
  L1: '#B6CEEC',
  L2: '#89AEE0',
  L3: '#5B90D4',
  L4: '#3372C1',
  L5: '#123A66',
};

export const LEVEL_LABEL: Record<Level, string> = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  L4: 'L4',
  L5: 'L5',
};
