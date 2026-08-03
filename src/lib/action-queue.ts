// Types + constants for the dashboard action queue. Lives outside
// the 'use server' actions file (Next.js 14 forbids non-function
// exports from server actions modules).

export type ActionType =
  | 'mention'
  | 'overdue_task'
  | 'cold_high_value'
  | 'pending_approval';

/**
 * Type-level weights that drive the ranking. Kept as a single readable
 * constant so tuning is a one-line change. The intent (v1):
 *
 *   overdue_task + mention share the top tier — both are personal and
 *     time-sensitive (someone is waiting on the viewer specifically).
 *   cold_high_value ranks below them but above approvals — it's
 *     proactive work with real dollar-value at risk.
 *   pending_approval trails — it's queue work, less urgent than a
 *     stakeholder going silent while carrying real value.
 *
 * Priority score = TYPE_WEIGHT[type] + per-item tiebreak in [0, 99]:
 *   overdue_task     — days overdue (older = bigger)
 *   mention          — 99 - days old (newer = bigger)
 *   cold_high_value  — log-scaled value bucket (0..99)
 *   pending_approval — days old (older = bigger)
 *
 * Bounded tiebreak keeps the bucketing legible — a type-A item can
 * never leapfrog a type-B item just because it accumulated age.
 */
export const TYPE_WEIGHT: Record<ActionType, number> = {
  overdue_task: 400,
  mention: 400,
  cold_high_value: 200,
  pending_approval: 100,
};

/**
 * Value threshold above which a cold-stakeholder row gets a visible
 * "high value" tag. Same 100M AED cutoff the coverage radar uses for
 * its bottom band — keeps mental models consistent across surfaces.
 */
export const HIGH_VALUE_THRESHOLD_AED = 100_000_000;

/** Cold cutoff — matches band 4 in the 0089 temperature RPC. */
export const COLD_DAYS = 180;
/** Cooling cutoff — band 3 in 0089. */
export const COOLING_DAYS = 90;

export type CompanyStub = {
  id: string;
  canonical_name: string;
  company_type: string;
  current_level: string;
};

export type ActionItem = {
  /** Stable across reloads for the same underlying row. Used as React key. */
  key: string;
  type: ActionType;
  priority: number;
  /** Human line rendered as the row title (stakeholder name bolded by the UI). */
  reason: string;
  /** Right-side deep link the row opens on click. */
  link_url: string;
  /** Sub-line context — level · type · value/age. */
  context: string;
  /** ISO — used for the muted "3d ago" suffix. */
  occurred_at: string;
  /** For sizing / high-value tag on cold rows. Undefined for other types. */
  value_aed?: number | null;
  /** Full company shim so the UI can render level / type badges without a re-fetch. */
  company: CompanyStub;
};

export type ActionQueue = {
  /** Sorted, ready to render. */
  items: ActionItem[];
  /** True if the viewer's role can approve level changes (admin only). */
  viewerIsApprover: boolean;
};

/**
 * Compact AED — matches formatAedCompact in market-value-engagement.ts.
 * Duplicated (not imported) because this file is a leaf that the panel
 * imports on the client too; the market-value module is fine to reuse
 * but avoiding a cross-panel import keeps the queue self-contained.
 */
export function formatAed(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `AED ${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `AED ${(n / 1_000).toFixed(0)}K`;
  return `AED ${n.toFixed(0)}`;
}

/** Days between two dates, integer, positive if `from` is older than `to`. */
export function daysBetween(from: string | Date, to: Date): number {
  const ms = to.getTime() - new Date(from).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** "3d ago", "just now", "in 2d" — used for the muted timestamp on rows. */
export function relativeAge(iso: string, now: Date): string {
  const d = daysBetween(iso, now);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d > 1) return `${d}d ago`;
  if (d === -1) return 'in 1d';
  return `in ${-d}d`;
}
