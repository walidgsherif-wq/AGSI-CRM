import { z } from 'zod';

export const REPORT_TYPES = ['monthly_snapshot', 'quarterly_strategic'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  monthly_snapshot: 'Monthly snapshot',
  quarterly_strategic: 'Quarterly strategic',
};

export const REPORT_STATUSES = ['draft', 'finalised', 'archived'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  draft: 'Draft',
  finalised: 'Finalised',
  archived: 'Archived',
};

export const reportCreateSchema = z
  .object({
    report_type: z.enum(REPORT_TYPES),
    period_label: z.string().trim().min(1).max(120),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    fiscal_year: z.coerce.number().int().min(2020).max(2100),
    fiscal_quarter: z
      .union([z.coerce.number().int().min(1).max(4), z.literal(''), z.undefined(), z.null()])
      .transform((v) => {
        if (v === '' || v === undefined || v === null) return null;
        return Number(v);
      })
      .nullable(),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: 'period_end must be ≥ period_start',
    path: ['period_end'],
  })
  .refine((d) => d.report_type !== 'quarterly_strategic' || d.fiscal_quarter !== null, {
    message: 'Quarterly reports require a quarter (1–4).',
    path: ['fiscal_quarter'],
  });

export type ReportCreate = z.infer<typeof reportCreateSchema>;

// Payload shape — kept loose; pages that read it cast to specific shapes.
export type LeadershipReportPayload = {
  report_metadata: {
    period_label: string;
    period_start: string;
    period_end: string;
    fiscal_year: number;
    fiscal_quarter: number | null;
    report_type: ReportType;
    generated_at: string;
    universe_total: number;
  };
  executive_headlines: Record<string, number>;
  kpi_scorecard: {
    team_rollup: Record<string, { actual: number; target: number }>;
    per_bdm: Array<{
      user_id: string;
      name: string;
      role: string;
      driver_a_pct: number | null;
      driver_b_pct: number | null;
      driver_c_pct: number | null;
      driver_d_pct: number | null;
      bei: number | null;
      bei_tier: string | null;
    }>;
  };
  ecosystem_awareness: {
    snapshot:
      | {
          snapshot_date: string;
          lifetime_score: number;
          active_score: number;
          theoretical_max: number;
          lifetime_pct: number;
          active_pct: number;
        }
      | null;
    quarterly_trend: Array<{
      snapshot_date: string;
      lifetime_score: number;
      active_score: number;
    }>;
  };
  heat_maps_frozen_state: {
    level_distribution: Record<string, number>;
    level_distribution_universe_total: number;
    engagement_freshness: {
      hot_count: number;
      warm_count: number;
      cooling_count: number;
      cold_count: number;
      never_count: number;
    };
    geographic: Array<{ city: string; count: number }>;
  };
  pipeline_movements: {
    forward_moves: Array<{
      company_id: string;
      company_name: string;
      from_level: string;
      to_level: string;
      date: string;
      owner_name: string | null;
      is_credited: boolean;
    }>;
    regressions: Array<{
      company_id: string;
      company_name: string;
      from_level: string;
      to_level: string;
      date: string;
      owner_name: string | null;
    }>;
  };
  key_stakeholder_progress: Array<{
    company_id: string;
    company_name: string;
    company_type: string;
    current_level: string;
    owner_name: string | null;
    last_engagement: string | null;
    moved_this_period: boolean;
    flagged_stagnating: boolean;
    lifetime_ecosystem_points: number;
    active_ecosystem_points: number;
    narrative: string | null;
  }>;
  market_snapshot_reference: {
    source_upload_id: string | null;
    source_upload_date: string | null;
    projects_by_stage: Record<string, number>;
    total_market_value_aed: number;
  };
};
