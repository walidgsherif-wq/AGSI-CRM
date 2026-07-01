'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import type {
  MarketValueBand,
  MarketValueColdRow,
  MarketValueEngagement,
  MarketValueHeadline,
  MarketValueParetoRow,
  MarketValueTopUnengagedRow,
  MarketValueWhitespaceRow,
} from '@/lib/market-value-engagement';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

type RawPayload = {
  headline?: Partial<Record<keyof MarketValueHeadline, number | string>> | null;
  cold_split?: Array<{ band?: string; value?: number | string; project_count?: number | string }> | null;
  whitespace?: Array<{
    id?: string;
    name?: string;
    value_aed?: number | string;
    stage?: string;
    city?: string | null;
    sector?: string | null;
  }> | null;
  pareto?: Array<{
    top_n?: number | string;
    cum_value?: number | string;
    engaged_count?: number | string;
    target_count?: number | string;
  }> | null;
  top_unengaged?: Array<{
    id?: string;
    canonical_name?: string;
    company_type?: string;
    associated_value?: number | string;
    rn?: number | string;
  }> | null;
};

const BANDS = ['hot', 'warm', 'cooling', 'older'] as const;

function toNumber(n: unknown): number {
  if (typeof n === 'number') return n;
  if (typeof n === 'string' && n.trim() !== '') {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

function toBand(raw: unknown): MarketValueBand {
  return (BANDS as readonly string[]).includes(raw as string)
    ? (raw as MarketValueBand)
    : 'older';
}

/**
 * Value-weighted engagement analytics for the dashboard. Reads the
 * jsonb payload from get_market_value_engagement() (0091) and folds
 * the numeric strings Postgres uses for numeric(18,2) columns into
 * plain JS numbers so the panel doesn't need to defend against them.
 */
export async function getMarketValueEngagement(): Promise<
  MarketValueEngagement | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') return { error: 'forbidden' };

  const { data, error } = await supabase().rpc('get_market_value_engagement');
  if (error) return { error: error.message };

  const payload = (data as RawPayload | null) ?? {};

  const headline: MarketValueHeadline = {
    total_market_value: toNumber(payload.headline?.total_market_value),
    engaged_value: toNumber(payload.headline?.engaged_value),
    unengaged_value: toNumber(payload.headline?.unengaged_value),
    live_project_count: toNumber(payload.headline?.live_project_count),
    value_known_count: toNumber(payload.headline?.value_known_count),
    engaged_project_count: toNumber(payload.headline?.engaged_project_count),
    engaged_company_count: toNumber(payload.headline?.engaged_company_count),
  };

  const cold_split: MarketValueColdRow[] = (payload.cold_split ?? []).map(
    (r) => ({
      band: toBand(r.band),
      value: toNumber(r.value),
      project_count: toNumber(r.project_count),
    }),
  );

  const whitespace: MarketValueWhitespaceRow[] = (payload.whitespace ?? []).map(
    (r) => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      value_aed: toNumber(r.value_aed),
      stage: String(r.stage ?? ''),
      city: r.city ?? null,
      sector: r.sector ?? null,
    }),
  );

  const pareto: MarketValueParetoRow[] = (payload.pareto ?? []).map((r) => ({
    top_n: toNumber(r.top_n),
    cum_value: toNumber(r.cum_value),
    engaged_count: toNumber(r.engaged_count),
    target_count: toNumber(r.target_count),
  }));

  const top_unengaged: MarketValueTopUnengagedRow[] = (
    payload.top_unengaged ?? []
  ).map((r) => ({
    id: String(r.id ?? ''),
    canonical_name: String(r.canonical_name ?? ''),
    company_type: String(r.company_type ?? ''),
    associated_value: toNumber(r.associated_value),
    rn: toNumber(r.rn),
  }));

  return { headline, cold_split, whitespace, pareto, top_unengaged };
}
