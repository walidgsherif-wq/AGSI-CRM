import React from 'react';
import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { ROLE_LABEL } from '@/types/domain';
import { EcosystemPanel } from '@/components/domain/EcosystemPanel';
import { DataFreshnessBadge } from '@/components/domain/DataFreshnessBadge';
import {
  fetchFiscalStartMonth,
  getFiscalContext,
  quarterStatusLabel,
  type QuarterInfo,
} from '@/lib/fiscal';
import { RebuildButton } from './_components/RebuildButton';
import { CoverageRadarPanel } from './_components/CoverageRadarPanel';
import { MemberSelector, type BdMember } from './_components/MemberSelector';
import { MyEventsCard, type MyEventRow } from './_components/MyEventsCard';
import {
  TeamEventsCard,
  type TeamEventSummary,
} from './_components/TeamEventsCard';
import { getCoverageByType } from '@/server/actions/coverage';
import type { EventType } from '@/lib/zod/event';

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { member?: string };
}) {
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Fiscal year/quarter respect app_settings.fiscal_year_start_month
  // (mirrors SQL helpers in 0021_functions_triggers.sql:47-73). All
  // four quarters are derived up-front so the table can render the
  // explicit Q1..Q4 track with in-progress/completed markers.
  const startMonth = await fetchFiscalStartMonth(supabase);
  const { fy, fq, quarters } = getFiscalContext(startMonth, new Date());

  // Dashboard scope (?member=). leadership locked to team rollup;
  // bd_manager locked to self; admin/bd_head can pick "team", "self",
  // or any BD member's uuid.
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

  let selection: 'team' | string; // 'team' | uuid
  let viewedUserId: string | null; // null => team rollup
  if (user.role === 'leadership') {
    selection = 'team';
    viewedUserId = null;
  } else if (user.role === 'bd_manager') {
    selection = user.id;
    viewedUserId = user.id;
  } else {
    // admin / bd_head
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
      // Unknown / deactivated — fall back to team.
      selection = 'team';
      viewedUserId = null;
    }
  }
  const viewedProfile = viewedUserId ? memberById.get(viewedUserId) : null;
  const showSelf = viewedUserId !== null;
  const viewLabel =
    viewedUserId === null
      ? 'Team rollup'
      : viewedUserId === user.id
        ? 'Your'
        : `${viewedProfile?.full_name ?? 'Member'}’s`;

  // Initial radar data for the default 'all' band. Re-fetches client-
  // side when the user picks a different value band.
  const initialCoverage = await getCoverageByType('all');

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

  // BEI is per-user. Team rollup has no BEI semantics, so we only
  // fetch when a specific member is being viewed AND they're in a
  // role that the bei_for_caller view exposes.
  let bei: BEIRow | null = null;
  const beiEligibleRoles: Array<'bd_manager' | 'bd_head'> = ['bd_manager', 'bd_head'];
  const viewedRole = viewedProfile?.role;
  if (viewedUserId !== null && viewedRole && beiEligibleRoles.includes(viewedRole as 'bd_manager' | 'bd_head')) {
    const beiRes = await supabase
      .from('bei_for_caller')
      .select(
        'user_id, driver_a_pct, driver_b_pct, driver_c_pct, driver_d_pct, bei, bei_tier, last_computed_at',
      )
      .eq('user_id', viewedUserId)
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

  // Event-attendance log — standalone (no KPI/pipeline coupling).
  //   - "My events attended" (card): the viewer's own rows, latest 10.
  //   - "Team events" (card, admin + leadership): rollup of the current
  //     fiscal year. Period filter on /events is more granular.
  const fyStartDate = quarters[0]?.startDate.toISOString().slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);
  const myEventsRes = await supabase
    .from('event_attendance')
    .select(
      'id, event_name, event_date, event_type, website, value_note, feedback, status, proof_path, confirmed_at',
    )
    .eq('member_id', user.id)
    .order('event_date', { ascending: false })
    .limit(20)
    .returns<MyEventRow[]>();
  const myEvents = myEventsRes.data ?? [];

  const showTeamEvents = user.role === 'admin' || user.role === 'leadership';
  let teamEventsSummary: TeamEventSummary | null = null;
  if (showTeamEvents) {
    type TeamRow = {
      id: string;
      member_id: string;
      event_name: string;
      event_date: string;
      event_type: EventType;
      status: 'planned' | 'attended';
      proof_path: string | null;
      member: { full_name: string } | { full_name: string }[] | null;
    };
    // Pull a generous slice covering FY-to-date AND any future-dated
    // planned rows so the "Upcoming team events" panel can surface
    // events scheduled past today / past FY end.
    const { data } = await supabase
      .from('event_attendance')
      .select(
        'id, member_id, event_name, event_date, event_type, status, proof_path, member:profiles!event_attendance_member_id_fkey(full_name)',
      )
      .gte('event_date', fyStartDate ?? '0001-01-01')
      .order('event_date', { ascending: false })
      .returns<TeamRow[]>();
    const rows = data ?? [];
    const attended = rows.filter((r) => r.status === 'attended');
    const planned = rows.filter(
      (r) => r.status === 'planned' && r.event_date >= todayDate,
    );
    const uniqueMembers = new Set(attended.map((r) => r.member_id));
    const verifiedTotal = attended.filter((r) => !!r.proof_path).length;
    const memberNameOf = (r: TeamRow) =>
      Array.isArray(r.member)
        ? (r.member[0]?.full_name ?? null)
        : (r.member?.full_name ?? null);
    teamEventsSummary = {
      attendedTotal: attended.length,
      verifiedTotal,
      uniqueMembers: uniqueMembers.size,
      periodLabel: `FY${fy}`,
      recentAttended: attended.slice(0, 5).map((r) => ({
        id: r.id,
        event_name: r.event_name,
        event_date: r.event_date,
        event_type: r.event_type,
        member_name: memberNameOf(r),
        verified: !!r.proof_path,
      })),
      // Sort upcoming ascending so the nearest event is on top.
      upcoming: [...planned]
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          event_name: r.event_name,
          event_date: r.event_date,
          event_type: r.event_type,
          member_name: memberNameOf(r),
        })),
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Dashboard</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {user.fullName} · {ROLE_LABEL[user.role]} · FY{fy} Q{fq}
          </p>
          <div className="mt-2">
            <DataFreshnessBadge asOf={snapshotDate} compact />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canPickMember && (
            <MemberSelector
              members={members}
              currentSelection={selection}
              currentUserId={user.id}
            />
          )}
          {user.role === 'admin' && <RebuildButton />}
        </div>
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

      {user.role !== 'bd_manager' && <EcosystemPanel />}

      <CoverageRadarPanel initial={initialCoverage} initialBand="all" />

      <MyEventsCard rows={myEvents} memberId={user.id} />

      {showTeamEvents && teamEventsSummary && (
        <TeamEventsCard summary={teamEventsSummary} />
      )}

      {bei && (
        <Card>
          <CardHeader>
            <CardTitle>
              {viewLabel === 'Your' ? 'Your' : viewLabel} BEI — FY{fy} Q{fq}
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
        {canPickMember && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-agsi-navy">
              Drivers — FY{fy}, Q1–Q4
            </h2>
            <MemberSelector
              members={members}
              currentSelection={selection}
              currentUserId={user.id}
            />
          </div>
        )}
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
