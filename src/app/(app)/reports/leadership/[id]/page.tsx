import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { type Level } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  REPORT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  type LeadershipReportPayload,
  type ReportStatus,
  type ReportType,
} from '@/lib/zod/leadership-report';
import { LeadershipFeedbackEditor } from './_components/LeadershipFeedbackEditor';

export const dynamic = 'force-dynamic';

type Report = {
  id: string;
  report_type: ReportType;
  period_label: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  status: ReportStatus;
  generated_at: string;
  finalised_at: string | null;
  executive_summary: string | null;
  payload_json: LeadershipReportPayload;
  leadership_feedback_text: string | null;
  leadership_feedback_at: string | null;
  feedback_by: { full_name: string } | { full_name: string }[] | null;
};

type Stakeholder = {
  id: string;
  company_id: string | null;
  company_name_at_time: string;
  company_type_at_time: string;
  level_at_time: Level;
  owner_name_at_time: string | null;
  is_key_stakeholder: boolean;
  moved_this_period: boolean;
  flagged_stagnating: boolean;
  active_ecosystem_points: number;
  lifetime_ecosystem_points: number;
  narrative: string | null;
};

export default async function LeadershipReportViewer({
  params,
}: {
  params: { id: string };
}) {
  await requireRole(['admin', 'leadership', 'bd_head']);
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: report } = await supabase
    .from('leadership_reports')
    .select(
      `id, report_type, period_label, period_start, period_end, fiscal_year, fiscal_quarter,
       status, generated_at, finalised_at, executive_summary, payload_json,
       leadership_feedback_text, leadership_feedback_at,
       feedback_by:profiles!leadership_reports_leadership_feedback_by_fkey(full_name)`,
    )
    .eq('id', params.id)
    .maybeSingle<Report>();

  if (!report) notFound();

  // bd_head + leadership only see finalised + archived. Drafts → admin only.
  if (report.status === 'draft' && user.role !== 'admin') notFound();

  const { data: stakeholders } = await supabase
    .from('leadership_report_stakeholders')
    .select(
      'id, company_id, company_name_at_time, company_type_at_time, level_at_time, owner_name_at_time, is_key_stakeholder, moved_this_period, flagged_stagnating, active_ecosystem_points, lifetime_ecosystem_points, narrative',
    )
    .eq('report_id', params.id)
    .order('is_key_stakeholder', { ascending: false })
    .order('company_name_at_time')
    .returns<Stakeholder[]>();

  const payload = report.payload_json;
  const feedbackByName = pickName(report.feedback_by);

  return (
    <div className="space-y-6">
      <Hero report={report} />

      {report.status === 'finalised' && user.role === 'leadership' && (
        <FeedbackPanel
          reportId={report.id}
          initial={report.leadership_feedback_text ?? ''}
          editable
        />
      )}
      {report.leadership_feedback_text && user.role !== 'leadership' && (
        <FeedbackPanel
          reportId={report.id}
          initial={report.leadership_feedback_text}
          editable={false}
          author={feedbackByName}
          when={report.leadership_feedback_at}
        />
      )}

      {report.executive_summary && (
        <Card>
          <CardHeader>
            <CardTitle>Executive summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-agsi-navy">
              {report.executive_summary}
            </p>
          </CardContent>
        </Card>
      )}

      <KPIScorecard payload={payload} />
      <EcosystemSection payload={payload} />
      <PipelineSection payload={payload} />
      <HeatMapSection payload={payload} />
      <KeyStakeholdersSection
        stakeholders={(stakeholders ?? []).filter((s) => s.is_key_stakeholder)}
        narrativesFromPayload={payload.key_stakeholder_progress}
      />
      <MarketReference payload={payload} />

      {report.status === 'archived' && (
        <Card>
          <CardContent className="p-4 text-xs text-agsi-darkGray">
            <strong>Archived</strong> — read-only audit-of-record copy. The live
            dashboards may reflect different values today.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Hero({ report }: { report: Report }) {
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-agsi-navy">{report.period_label}</h1>
        <Badge variant={report.status === 'finalised' ? 'green' : 'neutral'}>
          {REPORT_STATUS_LABEL[report.status]}
        </Badge>
        <Badge variant="blue">{REPORT_TYPE_LABEL[report.report_type]}</Badge>
      </div>
      <p className="mt-1 text-sm text-agsi-darkGray">
        FY{report.fiscal_year}
        {report.fiscal_quarter ? ` Q${report.fiscal_quarter}` : ''} · period{' '}
        {report.period_start} → {report.period_end}
        {report.finalised_at &&
          ` · finalised ${new Date(report.finalised_at).toISOString().slice(0, 10)}`}
      </p>
      <p className="mt-2 text-xs italic text-agsi-darkGray">
        Frozen snapshot — data as at {report.period_end}. Current live values may differ.
      </p>
    </div>
  );
}

function FeedbackPanel({
  reportId,
  initial,
  editable,
  author,
  when,
}: {
  reportId: string;
  initial: string;
  editable: boolean;
  author?: string | null;
  when?: string | null;
}) {
  if (editable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your feedback</CardTitle>
          <CardDescription>
            Free-text response to the report. Only you can edit; admins can see what you
            write but cannot edit it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadershipFeedbackEditor reportId={reportId} initial={initial} />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leadership feedback</CardTitle>
        <CardDescription>
          {author ? `Written by ${author}` : 'Leadership feedback'}
          {when ? ` · ${new Date(when).toISOString().slice(0, 10)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm text-agsi-navy">{initial}</p>
      </CardContent>
    </Card>
  );
}

function KPIScorecard({ payload }: { payload: LeadershipReportPayload }) {
  const team = payload.kpi_scorecard?.team_rollup ?? {};
  const perBdm = payload.kpi_scorecard?.per_bdm ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPI scorecard</CardTitle>
        <CardDescription>
          Team rollup at period_end (latest snapshot ≤ period). Per-BDM BEI snapshot
          for the same period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {(['A', 'B', 'C', 'D'] as const).map((d) => {
            const t = team[d] ?? { actual: 0, target: 0 };
            const pct = t.target > 0 ? (Number(t.actual) / Number(t.target)) * 100 : 0;
            return (
              <div
                key={d}
                className="rounded-lg border border-agsi-lightGray bg-white p-3"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
                  Driver {d}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-agsi-navy">
                  {fmt(t.actual)} / {fmt(t.target)}
                </p>
                <p className="text-xs text-agsi-darkGray">{fmtPct(pct)}%</p>
              </div>
            );
          })}
        </div>
        {perBdm.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-agsi-darkGray">
                  <th className="px-2 py-1">Member</th>
                  <th className="px-2 py-1">A</th>
                  <th className="px-2 py-1">B</th>
                  <th className="px-2 py-1">C</th>
                  <th className="px-2 py-1">D</th>
                  <th className="px-2 py-1">BEI</th>
                  <th className="px-2 py-1">Tier</th>
                </tr>
              </thead>
              <tbody>
                {perBdm.map((m) => (
                  <tr key={m.user_id} className="border-t border-agsi-lightGray">
                    <td className="px-2 py-1 font-medium text-agsi-navy">{m.name}</td>
                    <td className="px-2 py-1 tabular-nums">{driverPct(m.driver_a_pct)}</td>
                    <td className="px-2 py-1 tabular-nums">{driverPct(m.driver_b_pct)}</td>
                    <td className="px-2 py-1 tabular-nums">{driverPct(m.driver_c_pct)}</td>
                    <td className="px-2 py-1 tabular-nums">{driverPct(m.driver_d_pct)}</td>
                    <td className="px-2 py-1 tabular-nums">
                      {m.bei != null ? `${(Number(m.bei) * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-2 py-1 text-agsi-darkGray">{m.bei_tier ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EcosystemSection({ payload }: { payload: LeadershipReportPayload }) {
  const snap = payload.ecosystem_awareness?.snapshot;
  const trend = payload.ecosystem_awareness?.quarterly_trend ?? [];
  if (!snap) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ecosystem awareness</CardTitle>
        <CardDescription>
          Snapshot at the report period_end. Active = last 90 days; lifetime = all-time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            label="Active (last 90 days)"
            value={fmt(snap.active_score)}
            denominator={fmt(snap.theoretical_max)}
            pct={snap.active_pct}
          />
          <Stat
            label="Lifetime"
            value={fmt(snap.lifetime_score)}
            denominator={fmt(snap.theoretical_max)}
            pct={snap.lifetime_pct}
          />
        </div>
        {trend.length > 1 && (
          <p className="mt-2 text-xs text-agsi-darkGray">
            Trend points captured at month-end: {trend.length} months in payload.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineSection({ payload }: { payload: LeadershipReportPayload }) {
  const fwd = payload.pipeline_movements?.forward_moves ?? [];
  const reg = payload.pipeline_movements?.regressions ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline movements</CardTitle>
        <CardDescription>
          {fwd.length} forward-credited level changes
          {reg.length > 0 && `, ${reg.length} regressions`} during the period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fwd.length === 0 ? (
          <p className="text-sm text-agsi-darkGray">No forward moves in period.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {fwd.slice(0, 30).map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/companies/${m.company_id}`}
                  className="font-medium text-agsi-navy hover:underline"
                >
                  {m.company_name}
                </Link>
                <span className="text-agsi-darkGray">
                  {m.from_level} → {m.to_level}
                </span>
                <span className="text-agsi-darkGray">
                  {new Date(m.date).toISOString().slice(0, 10)}
                </span>
                {m.owner_name && <span className="text-agsi-darkGray">· {m.owner_name}</span>}
              </li>
            ))}
            {fwd.length > 30 && (
              <li className="italic text-agsi-darkGray">
                +{fwd.length - 30} more in payload.
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HeatMapSection({ payload }: { payload: LeadershipReportPayload }) {
  const f = payload.heat_maps_frozen_state?.engagement_freshness;
  const ld = payload.heat_maps_frozen_state?.level_distribution ?? {};
  const universe = payload.heat_maps_frozen_state?.level_distribution_universe_total ?? 789;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heat maps (frozen)</CardTitle>
        <CardDescription>Counts captured at the report period_end.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
            Level distribution (universe of {universe})
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const).map((lvl) => (
              <div key={lvl} className="rounded border border-agsi-lightGray p-2 text-center">
                <p className="text-xs font-medium text-agsi-darkGray">{lvl}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-agsi-navy">
                  {Number((ld as Record<string, number>)[lvl] ?? 0)}
                </p>
              </div>
            ))}
          </div>
        </div>
        {f && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
              Engagement freshness (universe)
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <FreshnessTile label="Hot ≤14d" value={f.hot_count} tone="green" />
              <FreshnessTile label="Warm 15–45" value={f.warm_count} tone="lime" />
              <FreshnessTile label="Cooling 46–90" value={f.cooling_count} tone="amber" />
              <FreshnessTile label="Cold >90" value={f.cold_count} tone="red" />
              <FreshnessTile label="Never" value={f.never_count} tone="grey" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeyStakeholdersSection({
  stakeholders,
  narrativesFromPayload,
}: {
  stakeholders: Stakeholder[];
  narrativesFromPayload?: LeadershipReportPayload['key_stakeholder_progress'];
}) {
  // Source of truth for narrative is the payload (frozen at generation),
  // but also fall back to live denormalised row if a draft updated since.
  const overrideNarrative = new Map<string, string | null>();
  for (const r of narrativesFromPayload ?? []) {
    overrideNarrative.set(r.company_id, r.narrative);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key stakeholder progress</CardTitle>
        <CardDescription>
          {stakeholders.length} key-tagged stakeholders in this report.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {stakeholders.length === 0 ? (
          <p className="px-6 py-4 text-sm text-agsi-darkGray">
            No key-tagged stakeholders. Tag companies via{' '}
            <code>companies.is_key_stakeholder = true</code>.
          </p>
        ) : (
          <ul className="divide-y divide-agsi-lightGray">
            {stakeholders.map((s) => {
              const narrative =
                (s.company_id ? overrideNarrative.get(s.company_id) : null) ?? s.narrative;
              return (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={s.company_id ? `/companies/${s.company_id}` : '#'}
                      className="text-sm font-medium text-agsi-navy hover:underline"
                    >
                      {s.company_name_at_time}
                    </Link>
                    <LevelBadge level={s.level_at_time} />
                    {s.moved_this_period && <Badge variant="green">moved</Badge>}
                    {s.flagged_stagnating && <Badge variant="amber">stagnating</Badge>}
                    <span className="text-xs text-agsi-darkGray">
                      {COMPANY_TYPE_LABEL[s.company_type_at_time as keyof typeof COMPANY_TYPE_LABEL] ??
                        s.company_type_at_time}
                    </span>
                    {s.owner_name_at_time && (
                      <span className="text-xs text-agsi-darkGray">
                        · owner {s.owner_name_at_time}
                      </span>
                    )}
                  </div>
                  {narrative && (
                    <p className="mt-1 text-sm text-agsi-navy">{narrative}</p>
                  )}
                  <p className="mt-1 text-xs text-agsi-darkGray">
                    Active points {fmt(s.active_ecosystem_points)} / Lifetime{' '}
                    {fmt(s.lifetime_ecosystem_points)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MarketReference({ payload }: { payload: LeadershipReportPayload }) {
  const m = payload.market_snapshot_reference;
  if (!m || !m.source_upload_id) return null;
  const stages = m.projects_by_stage ?? {};
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market snapshot reference</CardTitle>
        <CardDescription>
          From BNC upload dated {m.source_upload_date}. Total market value{' '}
          {fmt(m.total_market_value_aed)} AED.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {Object.entries(stages).map(([stage, count]) => (
            <div key={stage} className="rounded border border-agsi-lightGray p-2">
              <p className="font-medium text-agsi-darkGray">{stage}</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-agsi-navy">
                {Number(count)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  denominator,
  pct,
}: {
  label: string;
  value: string;
  denominator: string;
  pct: number;
}) {
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-agsi-navy">{value}</p>
      <p className="text-xs text-agsi-darkGray">
        of {denominator} · {fmtPct(pct)}%
      </p>
    </div>
  );
}

function FreshnessTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'lime' | 'amber' | 'red' | 'grey';
}) {
  const bg: Record<typeof tone, string> = {
    green: 'bg-agsi-green/10 text-agsi-green',
    lime: 'bg-rag-amber/10 text-rag-amber',
    amber: 'bg-rag-amber/15 text-rag-amber',
    red: 'bg-rag-red/10 text-rag-red',
    grey: 'bg-agsi-lightGray text-agsi-darkGray',
  };
  return (
    <div className={`rounded p-2 text-center ${bg[tone]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function fmt(n: number | string | null | undefined): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n ?? 0));
}

function fmtPct(n: number | string | null | undefined): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(n ?? 0));
}

function driverPct(n: number | null): string {
  if (n == null) return '—';
  return `${(Number(n) * 100).toFixed(0)}%`;
}

function pickName(g: { full_name: string } | { full_name: string }[] | null): string | null {
  if (!g) return null;
  if (Array.isArray(g)) return g[0]?.full_name ?? null;
  return g.full_name;
}
