import React from 'react';
import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireFeature } from '@/lib/auth/features';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { DataFreshnessBadge } from '@/components/domain/DataFreshnessBadge';
import { ROLE_LABEL } from '@/types/domain';
import {
  fetchFiscalStartMonth,
  getFiscalContext,
  quarterStatusLabel,
  type QuarterInfo,
} from '@/lib/fiscal';
import { MemberSelector, type BdMember } from '@/components/domain/MemberSelector';

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

const DRIVER_LABEL: Record<Driver, string> = {
  A: 'Driver A — L-level stakeholders',
  B: 'Driver B — Developer composition',
  C: 'Driver C — Consultant influence',
  D: 'Driver D — Visibility outputs',
};

// rebuild_kpi_actuals attributes A/B from level_history.owner_at_time
// (the stakeholder's owner at the moment of the move), and C/D from
// engagements.created_by / documents.uploaded_by (the actor). Surface
// the rule per-card so the description matches the data.
const DRIVER_CREDIT_NOTE: Record<Driver, string> = {
  A: 'Credit goes to the stakeholder’s owner at the time of the move.',
  B: 'Credit goes to the stakeholder’s owner at the time of the move.',
  C: 'Credit goes to the person who logged the engagement.',
  D: 'Credit goes to the person who uploaded the document.',
};

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: { member?: string };
}) {
  const user = await requireFeature('reports_scorecard');

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const startMonth = await fetchFiscalStartMonth(supabase);
  const { fy, fq, quarters } = getFiscalContext(startMonth, new Date());

  // Scope selector — mirrors the dashboard pre-Phase 1a behaviour:
  // leadership locked to team rollup; bd_manager locked to self;
  // admin/bd_head can pick "team", "self", or any BD member.
  const canPickMember = user.role === 'admin' || user.role === 'bd_head';
  let members: BdMember[] = [];
  if (canPickMember) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['admin', 'bd_head', 'bd_manager'])
      .order('full_name')
      .returns<BdMember[]>();
    members = data ?? [];
  }
  const memberById = new Map(members.map((m) => [m.id, m]));

  let selection: 'team' | string;
  let viewedUserId: string | null;
  if (user.role === 'leadership') {
    selection = 'team';
    viewedUserId = null;
  } else if (user.role === 'bd_manager') {
    selection = user.id;
    viewedUserId = user.id;
  } else {
    const raw = (searchParams.member ?? '').trim();
    if (!raw || raw === 'team') {
      selection = 'team';
      viewedUserId = null;
    } else if (raw === 'self') {
      selection = user.id;
      viewedUserId = user.id;
    } else if (memberById.has(raw)) {
      selection = raw;
      viewedUserId = raw;
    } else {
      selection = 'team';
      viewedUserId = null;
    }
  }
  const viewedProfile = viewedUserId ? memberById.get(viewedUserId) : null;
  const viewLabel =
    viewedUserId === null
      ? 'Team rollup'
      : viewedUserId === user.id
        ? 'Your'
        : `${viewedProfile?.full_name ?? 'Member'}’s`;

  const { data: playbook } = await supabase
    .from('playbook_targets')
    .select(
      'metric_code, metric_label, driver, q1_target, q2_target, q3_target, q4_target, annual_target',
    )
    .eq('fiscal_year', fy)
    .order('driver', { ascending: true })
    .order('metric_code', { ascending: true })
    .returns<PlaybookTargetRow[]>();

  const { data: memberTargets } =
    viewedUserId !== null
      ? await supabase
          .from('member_targets')
          .select('metric_code, q1_target, q2_target, q3_target, q4_target')
          .eq('user_id', viewedUserId)
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
  if (viewedUserId !== null) {
    actualsRes = await supabase
      .from('kpi_actuals_daily')
      .select('metric_code, fiscal_quarter, actual_value')
      .eq('user_id', viewedUserId)
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
          <Link href="/reports" className="text-xs text-agsi-darkGray hover:underline">
            ← Reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-agsi-navy">
            Driver scorecard — {viewLabel}
          </h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {user.fullName} · {ROLE_LABEL[user.role]} · FY{fy} Q{fq}
          </p>
          <div className="mt-2">
            <DataFreshnessBadge asOf={snapshotDate} compact />
          </div>
        </div>
        {canPickMember && (
          <MemberSelector
            members={members}
            currentSelection={selection}
            currentUserId={user.id}
          />
        )}
      </div>

      {!snapshotDate && (
        <Card>
          <CardContent className="p-4 text-sm text-agsi-darkGray">
            No KPI snapshot yet.{' '}
            {user.role === 'admin'
              ? 'Rebuild via the dashboard’s "Rebuild KPI now" button.'
              : 'Ask an admin to run the first rebuild.'}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(['A', 'B', 'C', 'D'] as Driver[]).map((d) => (
          <Card key={d}>
            <CardHeader>
              <CardTitle>{DRIVER_LABEL[d]}</CardTitle>
              <CardDescription>
                {viewedUserId === null
                  ? 'Team rollup vs combined target'
                  : `${viewLabel} actuals vs target`}{' '}
                — FY{fy}, Q1–Q4 explicit. Counts events logged in the period
                (level moves, engagements, documents) — not the current state of
                the pipeline. {DRIVER_CREDIT_NOTE[d]}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {grouped[d].length === 0 ? (
                <p className="p-6 text-sm text-agsi-darkGray">
                  No playbook targets seeded for FY{fy} on Driver {d}.
                </p>
              ) : (
                <QuarterTrackTable
                  metrics={grouped[d]}
                  quarters={quarters}
                  actualFor={actualFor}
                  targetFor={targetFor}
                  ragVariant={ragVariant}
                  isOverride={(code) => memberTargetByMetric.has(code)}
                />
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

function QuarterTrackTable({
  metrics,
  quarters,
  actualFor,
  targetFor,
  ragVariant,
  isOverride,
}: {
  metrics: PlaybookTargetRow[];
  quarters: QuarterInfo[];
  actualFor: (code: string, q?: number | null) => number;
  targetFor: (m: PlaybookTargetRow, q?: number | null) => number;
  ragVariant: (a: number, t: number) => 'neutral' | 'red' | 'amber' | 'blue' | 'green';
  isOverride: (code: string) => boolean;
}) {
  return (
    <Table className="min-w-[720px]">
      <THead>
        <TR head>
          <TH className="px-4">Metric</TH>
          {quarters.map((qi) => {
            const liveLabel = quarterStatusLabel(qi);
            const isLive = qi.status === 'in_progress';
            const isDone = qi.status === 'completed';
            return (
              <TH
                key={qi.q}
                colSpan={2}
                className={`border-l border-agsi-lightGray/50 px-2 text-center ${
                  isLive ? 'bg-agsi-accent/5' : ''
                }`}
              >
                <div className="text-agsi-navy">Q{qi.q}</div>
                {isLive && (
                  <div className="text-xxs font-normal normal-case text-agsi-accent">
                    {liveLabel}
                  </div>
                )}
                {isDone && (
                  <div className="text-xxs font-normal normal-case text-agsi-darkGray">
                    completed
                  </div>
                )}
              </TH>
            );
          })}
          <TH className="border-l border-agsi-lightGray/50 px-4">FY</TH>
        </TR>
        <TR subhead>
          <TH></TH>
          {quarters.map((qi) => {
            const isLive = qi.status === 'in_progress';
            return (
              <React.Fragment key={qi.q}>
                <TH
                  className={`border-l border-agsi-lightGray/50 px-2 py-1 tabular ${
                    isLive ? 'bg-agsi-accent/5' : ''
                  }`}
                >
                  A
                </TH>
                <TH className={`px-2 py-1 tabular ${isLive ? 'bg-agsi-accent/5' : ''}`}>T</TH>
              </React.Fragment>
            );
          })}
          <TH className="border-l border-agsi-lightGray/50 px-4 py-1 tabular">A / T</TH>
        </TR>
      </THead>
      <TBody>
        {metrics.map((m) => {
          const actualFY = quarters.reduce((s, qi) => s + actualFor(m.metric_code, qi.q), 0);
          const targetFY = quarters.reduce((s, qi) => s + targetFor(m, qi.q), 0);
          const override = isOverride(m.metric_code);
          return (
            <TR key={m.metric_code}>
              <TD className="px-4">
                <div className="font-medium text-agsi-navy">{m.metric_label}</div>
                <div className="text-xs text-agsi-darkGray">
                  {m.metric_code}
                  {override && (
                    <Badge variant="purple" className="ml-2">
                      override
                    </Badge>
                  )}
                </div>
              </TD>
              {quarters.map((qi) => {
                const a = actualFor(m.metric_code, qi.q);
                const t = targetFor(m, qi.q);
                const variant = ragVariant(a, t);
                const isLive = qi.status === 'in_progress';
                const colourClass =
                  variant === 'red'
                    ? 'text-rag-red'
                    : variant === 'amber'
                      ? 'text-rag-amber'
                      : variant === 'green'
                        ? 'text-agsi-green'
                        : 'text-agsi-navy';
                return (
                  <React.Fragment key={qi.q}>
                    <TD
                      className={`border-l border-agsi-lightGray/50 px-2 tabular ${colourClass} ${
                        isLive ? 'bg-agsi-accent/5' : ''
                      }`}
                    >
                      {a}
                    </TD>
                    <TD
                      className={`px-2 tabular text-agsi-darkGray ${
                        isLive ? 'bg-agsi-accent/5' : ''
                      }`}
                    >
                      {t}
                    </TD>
                  </React.Fragment>
                );
              })}
              <TD className="border-l border-agsi-lightGray/50 px-4 tabular text-agsi-darkGray">
                <span className="text-agsi-navy">{actualFY}</span> / {targetFY}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
