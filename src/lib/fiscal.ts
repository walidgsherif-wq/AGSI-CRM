// Fiscal calendar helpers. Source of truth for start_month is
// app_settings.fiscal_year_start_month (default Jan = 1). Mirrors the
// Postgres helpers fiscal_year_of() / fiscal_quarter_of() in
// 0021_functions_triggers.sql.
//
// Used by the dashboard and the perf-review page to label quarters
// consistently and mark the live quarter "in progress · week X of N".

import type { SupabaseClient } from '@supabase/supabase-js';

export type QuarterStatus = 'completed' | 'in_progress' | 'upcoming';

export type QuarterInfo = {
  q: 1 | 2 | 3 | 4;
  startDate: Date;          // UTC midnight on first day of quarter
  endExclusive: Date;       // UTC midnight on first day of NEXT quarter
  status: QuarterStatus;
  elapsedWeeks: number;     // 0 for upcoming, totalWeeks for completed, 1..totalWeeks for in_progress
  totalWeeks: number;       // 13 for most quarters (rounded)
};

export type FiscalContext = {
  fy: number;
  fq: 1 | 2 | 3 | 4;        // current fiscal quarter
  startMonth: number;       // 1..12
  quarters: QuarterInfo[];  // length 4
};

/**
 * Reads the fiscal_year_start_month from app_settings.
 * Returns 1 (January) if the setting is missing or malformed.
 */
export async function fetchFiscalStartMonth(
  supabase: SupabaseClient,
): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('value_json')
    .eq('key', 'fiscal_year_start_month')
    .maybeSingle<{ value_json: { month?: number } | null }>();
  const m = data?.value_json?.month;
  return typeof m === 'number' && m >= 1 && m <= 12 ? m : 1;
}

/**
 * Returns the fiscal year that contains `now`, respecting startMonth.
 */
export function getCurrentFy(startMonth: number, now: Date): number {
  const monthNow = now.getUTCMonth() + 1;
  const yearNow = now.getUTCFullYear();
  return monthNow >= startMonth ? yearNow : yearNow - 1;
}

/**
 * Builds the four quarters of the given fiscal year. Each quarter's
 * status (upcoming / in_progress / completed) is derived by comparing
 * `now` to the quarter's UTC start/end. Math runs in UTC; the SQL
 * helpers use Asia/Dubai, but TZ skew (≤ ±4h) is well inside the
 * 1-week display granularity used here.
 */
export function buildQuartersForFy(
  startMonth: number,
  fy: number,
  now: Date,
): QuarterInfo[] {
  const dayMs = 86_400_000;
  const out: QuarterInfo[] = [];
  for (let q = 1; q <= 4; q++) {
    const monthsFromYearStart = (q - 1) * 3 + (startMonth - 1);
    const sYear = fy + Math.floor(monthsFromYearStart / 12);
    const sMonth = monthsFromYearStart % 12;
    const startDate = new Date(Date.UTC(sYear, sMonth, 1));

    const endMonthsFromYearStart = monthsFromYearStart + 3;
    const eYear = fy + Math.floor(endMonthsFromYearStart / 12);
    const eMonth = endMonthsFromYearStart % 12;
    const endExclusive = new Date(Date.UTC(eYear, eMonth, 1));

    const totalDays = Math.round((endExclusive.getTime() - startDate.getTime()) / dayMs);
    const totalWeeks = Math.round(totalDays / 7);

    let status: QuarterStatus;
    let elapsedWeeks: number;
    if (now < startDate) {
      status = 'upcoming';
      elapsedWeeks = 0;
    } else if (now >= endExclusive) {
      status = 'completed';
      elapsedWeeks = totalWeeks;
    } else {
      status = 'in_progress';
      const elapsedDays = (now.getTime() - startDate.getTime()) / dayMs;
      elapsedWeeks = Math.max(1, Math.min(totalWeeks, Math.ceil(elapsedDays / 7)));
    }

    out.push({
      q: q as 1 | 2 | 3 | 4,
      startDate,
      endExclusive,
      status,
      elapsedWeeks,
      totalWeeks,
    });
  }
  return out;
}

/**
 * Convenience wrapper for "now's" fiscal context. For dashboards.
 */
export function getFiscalContext(startMonth: number, now: Date): FiscalContext {
  const fy = getCurrentFy(startMonth, now);
  const quarters = buildQuartersForFy(startMonth, fy, now);
  const current = quarters.find((qInfo) => qInfo.status === 'in_progress');
  const fq = (current?.q ?? 4) as 1 | 2 | 3 | 4;
  return { fy, fq, startMonth, quarters };
}

/**
 * "FY2026" — fiscal-year label used in page headings.
 */
export function fiscalYearLabel(fy: number): string {
  return `FY${fy}`;
}

/**
 * "in progress · w6/13" for the live quarter; empty string otherwise.
 */
export function quarterStatusLabel(q: QuarterInfo): string {
  if (q.status === 'in_progress') {
    return `in progress · w${q.elapsedWeeks}/${q.totalWeeks}`;
  }
  return '';
}
