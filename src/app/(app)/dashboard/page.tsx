import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABEL } from '@/types/domain';
import { RebuildButton } from './_components/RebuildButton';

export const dynamic = 'force-dynamic';

type Driver = 'A' | 'B' | 'C' | 'D';

type PlaybookTargetRow = {
  metric_code: string;
  metric_label: string;
  driver: Driver;
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
  annual_target: number;
};

type MemberTargetRow = {
  metric_code: string;
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
};

type ActualRow = {
  metric_code: string;
  fiscal_quarter: number;
  actual_value: number;
};

type BEIRow = {
  user_id: string | null;
  driver_a_pct: number | null;
  driver_b_pct: number | null;
  driver_c_pct: number | null;
  driver_d_pct: number | null;
  bei: number | null;
  bei_tier: string | null;
  last_computed_at: string | null;
};

const DRIVER_LABEL: Record<Driver, string> = {
  A: 'Driver A — L-level stakeholders',
  B: 'Driver B — Developer composition',
  C: 'Driver C — Consultant influence',
  D: 'Driver D — Visibility outputs',
};

const TIER_VARIANT: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'gold'> = {
  below_threshold: 'red',
  approaching: 'amber',
  on_target: 'blue',
  full: 'green',
  stretch: 'gold',
};

const TIER_LABEL: Record<string, string> = {
  below_threshold: 'Below threshold',
  approaching: 'Approaching',
  on_target: 'On target',
  full: 'Full',
  stretch: 'Stretch',
};

function currentFY(): number {
  return new Date().getUTCFullYear();
}

function currentQuarter(): number {
  const m = new Date().getUTCMonth() + 1;
  return Math.ceil(m / 3);
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const fy = currentFY();
  const fq = currentQuarter();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const showSelf = user.role !== 'leadership';

  const { data: playbook } = await supabase
    .from('playbook_targets')
    .select(
      'metric_code, metric_label, driver, q1_target, q2_target, q3_target, q4_target, annual_target',
    )
    .eq('fiscal_year', fy)
    .order('driver', { ascending: true })
    .order('metric_code', { ascending: true })
    .returns<PlaybookTargetRow[]>();

  const { data: memberTargets } = showSelf
    ? await supabase
        .from('member_targets')
        .select('metric_code, q1_target, q2_target, q3_target, q4_target')
        .eq('user_id', user.id)
        .eq('fiscal_year', fy)
        .returns<MemberTargetRow[]>()
    : { data: [] as MemberTargetRow[] };

  const memberTargetByMetric = new Map((memberTargets ?? []).map((m) => [m.metric_code, m]));

  const { data: snap } = await supabase
    .from('kpi_actuals_daily')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot_date: string }>();
  const snapshotDate = snap?.snapshot_date ?? null;

  let actualsRes;
  if (showSelf) {
    actualsRes = await supabase
      .from('kpi_actuals_daily')
      .select('metric_code, fiscal_quarter, actual_value')
      .eq('user_id', user.id)
      .eq('fiscal_year', fy)
      .returns<ActualRow[]>();
  } else {
    actualsRes = await supabase
      .from('kpi_actuals_daily')
      .select('metric_code, fiscal_quarter, actual_value')
      .is('user_id', null)
      .eq('fiscal_year', fy)
      .returns<ActualRow[]>();
  }
  const actuals = actualsRes.data ?? [];

  let bei: BEIRow | null = null;
  if (user.role === 'bd_manager' || user.role === 'bd_head') {
    const beiRes = await supabase
      .from('bei_for_caller')
      .select(
        'user_id, driver_a_pct, driver_b_pct, driver_c_pct, driver_d_pct, bei, bei_tier, last_computed_at',
      )
      .eq('user_id', user.id)
      .eq('fiscal_year', fy)
      .eq('fiscal_quarter', fq)
      .maybeSingle<BEIRow>();
    bei = beiRes.data ?? null;
  }

  function actualFor(metricCode: string, quarter: number | null = null): number {
    if (quarter !== null) {
      return actuals
        .filter((a) => a.metric_code === metricCode && a.fiscal_quarter === quarter)
        .reduce((s, r) => s + Number(r.actual_value), 0);
    }
    return actuals
      .filter((a) => a.metric_code === metricCode)
      .reduce((s, r) => s + Number(r.actual_value), 0);
  }

  function targetFor(metric: PlaybookTargetRow, quarter: number | null = null): number {
    const override = memberTargetByMetric.get(metric.metric_code);
    if (quarter === null) {
      if (override)
        return (
          Number(override.q1_target) +
          Number(override.q2_target) +
          Number(override.q3_target) +
          Number(override.q4_target)
        );
      return Number(metric.annual_target);
    }
    if (override) {
      const overrideKey = `q${quarter}_target` as keyof MemberTargetRow;
      return Number(override[overrideKey]);
    }
    const key = `q${quarter}_target` as keyof PlaybookTargetRow;
    return Number(metric[key]);
  }

  function ragVariant(
    actual: number,
    target: number,
  ): 'neutral' | 'red' | 'amber' | 'blue' | 'green' {
    if (target === 0) return 'neutral';
    const pct = actual / target;
    if (pct < 0.5) return 'red';
    if (pct < 0.75) return 'amber';
    if (pct < 0.95) return 'blue';
    return 'green';
  }

  const grouped: Record<Driver, PlaybookTargetRow[]> = { A: [], B: [], C: [], D: [] };
  for (const m of playbook ?? []) grouped[m.driver].push(m);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Dashboard</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {user.fullName} · {ROLE_LABEL[user.role]} · FY{fy} Q{fq}
            {snapshotDate && (
              <>
                {' · KPI snapshot '}
                <span className="text-agsi-navy">{snapshotDate}</span>
              </>
            )}
          </p>
        </div>
        {user.role === 'admin' && <RebuildButton />}
      </div>

      {!snapshotDate && (
        <Card>
          <CardContent className="p-4 text-sm text-agsi-darkGray">
            No KPI snapshot yet.{' '}
            {user.role === 'admin'
              ? 'Click "Rebuild KPI now" above to compute the first one.'
              : 'Ask an admin to run the first rebuild.'}
          </CardContent>
        </Card>
      )}

      {bei && (
        <Card>
          <CardHeader>
            <CardTitle>
              Your BEI — FY{fy} Q{fq}
            </CardTitle>
            <CardDescription>
              Bonus Eligibility Index. Weighted average of Driver A (45%), B (20%), C (20%),
              D (15%). Capped at 120% per driver.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-4">
              <div>
                <p className="text-4xl font-semibold tabular text-agsi-navy">
                  {((bei.bei ?? 0) * 100).toFixed(0)}%
                </p>
                {bei.bei_tier && (
                  <Badge variant={TIER_VARIANT[bei.bei_tier] ?? 'neutral'} className="mt-1">
                    {TIER_LABEL[bei.bei_tier] ?? bei.bei_tier}
                  </Badge>
                )}
              </div>
              <div className="grid flex-1 gap-3 sm:grid-cols-4">
                <DriverPill label="A" pct={bei.driver_a_pct} />
                <DriverPill label="B" pct={bei.driver_b_pct} />
                <DriverPill label="C" pct={bei.driver_c_pct} />
                <DriverPill label="D" pct={bei.driver_d_pct} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(['A', 'B', 'C', 'D'] as Driver[]).map((d) => (
          <Card key={d}>
            <CardHeader>
              <CardTitle>{DRIVER_LABEL[d]}</CardTitle>
              <CardDescription>
                {showSelf ? 'Your actuals vs target' : 'Team rollup vs combined target'} — Q
                {fq} this quarter & FY total.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {grouped[d].length === 0 ? (
                <p className="p-6 text-sm text-agsi-darkGray">
                  No playbook targets seeded for FY{fy} on Driver {d}.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                      <th className="px-4 py-2 font-medium">Metric</th>
                      <th className="px-4 py-2 font-medium tabular">Q{fq} actual</th>
                      <th className="px-4 py-2 font-medium tabular">Q{fq} target</th>
                      <th className="px-4 py-2 font-medium">Q{fq} status</th>
                      <th className="px-4 py-2 font-medium tabular">FY actual</th>
                      <th className="px-4 py-2 font-medium tabular">FY target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[d].map((m) => {
                      const actualQ = actualFor(m.metric_code, fq);
                      const targetQ = targetFor(m, fq);
                      const actualFY = actualFor(m.metric_code);
                      const targetFY = targetFor(m);
                      const variantQ = ragVariant(actualQ, targetQ);
                      const override = memberTargetByMetric.has(m.metric_code);
                      return (
                        <tr key={m.metric_code} className="border-b border-agsi-lightGray/50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-agsi-navy">{m.metric_label}</div>
                            <div className="text-xs text-agsi-darkGray">
                              {m.metric_code}
                              {override && (
                                <Badge variant="purple" className="ml-2">
                                  override
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 tabular text-agsi-navy">{actualQ}</td>
                          <td className="px-4 py-3 tabular text-agsi-darkGray">{targetQ}</td>
                          <td className="px-4 py-3">
                            <Badge variant={variantQ}>
                              {targetQ === 0 ? '—' : `${Math.round((actualQ / targetQ) * 100)}%`}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 tabular text-agsi-navy">{actualFY}</td>
                          <td className="px-4 py-3 tabular text-agsi-darkGray">{targetFY}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {user.role === 'admin' && (
        <p className="text-xs text-agsi-darkGray">
          Edit per-member overrides at{' '}
          <Link href="/admin/targets" className="text-agsi-accent hover:underline">
            /admin/targets
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function DriverPill({ label, pct }: { label: string; pct: number | null }) {
  const value = pct == null ? null : Math.round(Number(pct) * 100);
  return (
    <div className="rounded-lg border border-agsi-lightGray p-3">
      <p className="text-xs uppercase tracking-wider text-agsi-darkGray">Driver {label}</p>
      <p className="mt-1 text-xl font-semibold tabular text-agsi-navy">
        {value == null ? '—' : `${value}%`}
      </p>
    </div>
  );
}
