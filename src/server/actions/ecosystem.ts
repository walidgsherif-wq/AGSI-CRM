'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type EcosystemSnapshot = {
  snapshot_date: string;
  lifetime_score: number;
  active_score: number;
  theoretical_max: number;
  lifetime_pct: number;
  active_pct: number;
  computed_at: string;
  by_company_type: Record<string, { lifetime: number; active: number }>;
  by_level: Record<string, { lifetime: number; active: number }>;
  by_city: Record<string, { lifetime: number; active: number }>;
};

export type EcosystemTrendPoint = {
  snapshot_date: string;
  active_score: number;
  lifetime_score: number;
};

export type ContributorRow = {
  company_id: string;
  canonical_name: string;
  company_type: string | null;
  current_level: string | null;
  active_points: number;
};

export type CoolingRow = {
  company_id: string;
  canonical_name: string;
  company_type: string | null;
  current_level: string | null;
  lifetime_points: number;
  last_event_at: string | null;
};

export type EcosystemSummary = {
  snapshot: EcosystemSnapshot | null;
  trend: EcosystemTrendPoint[];
  topContributors: ContributorRow[];
  cooling: CoolingRow[];
};

export async function rebuildEcosystem() {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') return { error: 'forbidden' };
  const { error } = await supabase().rpc('rebuild_ecosystem_awareness');
  if (error) return { error: error.message };
  revalidatePath('/admin/ecosystem-rebuild');
  revalidatePath('/insights/ecosystem');
  revalidatePath('/dashboard');
  return { ok: true };
}

export type BackfillRow = { category: string; inserted: number };

export async function backfillEcosystem(): Promise<
  { rows: BackfillRow[] } | { error: string }
> {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'admin only' };
  const { data, error } = await supabase().rpc('backfill_ecosystem_events');
  if (error) return { error: error.message };
  revalidatePath('/admin/ecosystem-rebuild');
  revalidatePath('/insights/ecosystem');
  revalidatePath('/dashboard');
  return {
    rows: (data ?? []).map((r: { category: string; inserted: number | string }) => ({
      category: r.category,
      inserted: Number(r.inserted),
    })),
  };
}

/**
 * Reads ecosystem dashboard data for /insights/ecosystem and the
 * dashboard panel. RLS already blocks bd_manager from these tables; we
 * additionally short-circuit at the action layer to avoid fetch latency.
 */
export async function getEcosystemSummary(
  trendDays = 90,
  topLimit = 10,
  coolingLimit = 10,
): Promise<EcosystemSummary | { error: string }> {
  const user = await getCurrentUser();
  if (user.role === 'bd_manager') return { error: 'forbidden' };

  const sb = supabase();

  const [snapshotRes, trendRes, topRes, coolingRes] = await Promise.all([
    sb
      .from('ecosystem_awareness_current')
      .select(
        'snapshot_date, lifetime_score, active_score, theoretical_max, lifetime_pct, active_pct, computed_at, by_company_type, by_level, by_city',
      )
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle<EcosystemSnapshot>(),
    sb
      .from('ecosystem_awareness_current')
      .select('snapshot_date, active_score, lifetime_score')
      .gte(
        'snapshot_date',
        new Date(Date.now() - trendDays * 86_400_000).toISOString().slice(0, 10),
      )
      .order('snapshot_date', { ascending: true })
      .returns<EcosystemTrendPoint[]>(),
    sb.rpc('ecosystem_top_contributors', {
      p_window_days: 90,
      p_limit: topLimit,
    }),
    sb.rpc('ecosystem_cooling_accounts', {
      p_window_days: 90,
      p_limit: coolingLimit,
    }),
  ]);

  return {
    snapshot: snapshotRes.data ?? null,
    trend: (trendRes.data ?? []).map((r) => ({
      snapshot_date: r.snapshot_date,
      active_score: Number(r.active_score),
      lifetime_score: Number(r.lifetime_score),
    })),
    topContributors: ((topRes.data ?? []) as ContributorRow[]).map((r) => ({
      ...r,
      active_points: Number(r.active_points),
    })),
    cooling: ((coolingRes.data ?? []) as CoolingRow[]).map((r) => ({
      ...r,
      lifetime_points: Number(r.lifetime_points),
    })),
  };
}
