import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { ROLE_LABEL, type Level } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

type Driver = 'A' | 'B' | 'C' | 'D';

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
  is_active: boolean;
  created_at: string;
};

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
  fiscal_year: number;
  actual_value: number;
};

type BEIRow = {
  fiscal_quarter: number;
  driver_a_pct: number | null;
  driver_b_pct: number | null;
  driver_c_pct: number | null;
  driver_d_pct: number | null;
  bei: number | null;
  bei_tier: string | null;
};

type LevelHistoryRow = {
  id: string;
  changed_at: string;
  fiscal_year: number;
  fiscal_quarter: number;
  from_level: Level;
  to_level: Level;
  is_forward: boolean;
  is_credited: boolean;
  evidence_note: string | null;
  company_type_at_time: keyof typeof COMPANY_TYPE_LABEL;
  company: { id: string; canonical_name: string } | null;
};

type EngagementRow = {
  id: string;
  engagement_type: string;
  engagement_date: string;
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

function ragVariant(actual: number, target: number): 'neutral' | 'red' | 'amber' | 'blue' | 'green' {
  if (target === 0) return 'neutral';
  const pct = actual / target;
  if (pct < 0.5) return 'red';
  if (pct < 0.75) return 'amber';
  if (pct < 0.95) return 'blue';
  return 'green';
}

export default async function PerformanceReviewPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: { fy?: string };
}) {
  const viewer = await getCurrentUser();
  const fy = parseInt(searchParams.fy ?? String(currentFY()), 10);

  // Permission: bd_manager can view own only; others can view anyone.
  if (viewer.role === 'bd_manager' && viewer.id !== params.userId) {
    notFound();
  }
  if (viewer.role === 'leadership' || viewer.role === 'bd_head' || viewer.role === 'admin') {
    // pass
  } else if (viewer.id !== params.userId) {
    notFound();
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: subject } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at')
    .eq('id', params.userId)
    .maybeSingle<Profile>();

  if (!subject) notFound();

  const [playbookRes, memberRes, actualsRes, beiRes, levelRes, engagementRes] = await Promise.all([
    supabase
      .from('playbook_targets')
      .select('metric_code, metric_label, driver, q1_target, q2_target, q3_target, q4_target, annual_target')
      .eq('fiscal_year', fy)
      .order('driver')
      .order('metric_code')
      .returns<PlaybookTargetRow[]>(),
    supabase
      .from('member_targets')
      .select('metric_code, q1_target, q2_target, q3_target, q4_target')
      .eq('user_id', params.userId)
      .eq('fiscal_year', fy)
      .returns<MemberTargetRow[]>(),
    supabase
      .from('kpi_actuals_daily')
      .select('metric_code, fiscal_quarter, fiscal_year, actual_value')
      .eq('user_id', params.userId)
      .eq('fiscal_year', fy)
      .returns<ActualRow[]>(),
    supabase
      .from('bei_for_caller')
      .select('fiscal_quarter, driver_a_pct, driver_b_pct, driver_c_pct, driver_d_pct, bei, bei_tier')
      .eq('user_id', params.userId)
      .eq('fiscal_year', fy)
      .order('fiscal_quarter')
      .returns<BEIRow[]>(),
    supabase
      .from('level_history')
      .select(
        'id, changed_at, fiscal_year, fiscal_quarter, from_level, to_level, is_forward, is_credited, evidence_note, company_type_at_time, company:companies(id, canonical_name)',
      )
      .eq('owner_at_time', params.userId)
      .eq('fiscal_year', fy)
      .order('changed_at', { ascending: false })
      .limit(200)
      .returns<LevelHistoryRow[]>(),
    supabase
      .from('engagements')
      .select('id, engagement_type, engagement_date')
      .eq('created_by', params.userId)
      .gte('engagement_date', `${fy}-01-01`)
      .lte('engagement_date', `${fy}-12-31`)
      .returns<EngagementRow[]>(),
  ]);

  const playbook = playbookRes.data ?? [];
  const memberOverrides = memberRes.data ?? [];
  const actuals = actualsRes.data ?? [];
  const beiByQ = new Map((beiRes.data ?? []).map((b) => [b.fiscal_quarter, b]));
  const levelRows = levelRes.data ?? [];
  const engagements = engagementRes.data ?? [];

  const overrideByMetric = new Map(memberOverrides.map((m) => [m.metric_code, m]));

  const grouped: Record<Driver, PlaybookTargetRow[]> = { A: [], B: [], C: [], D: [] };
  for (const m of playbook) grouped[m.driver].push(m);

  function actualFor(code: string, q: number): number {
    return actuals
      .filter((a) => a.metric_code === code && a.fiscal_quarter === q)
      .reduce((s, r) => s + Number(r.actual_value), 0);
  }

  function targetFor(metric: PlaybookTargetRow, q: number): number {
    const o = overrideByMetric.get(metric.metric_code);
    if (o) {
      const k = `q${q}_target` as keyof MemberTargetRow;
      return Number(o[k]);
    }
    const k = `q${q}_target` as keyof PlaybookTargetRow;
    return Number(metric[k]);
  }

  // Composition: forward+credited level_history grouped by company_type_at_time per Q
  type CompKey = 'developer' | 'design_consultant' | 'main_contractor' | 'other';
  const compByQ = new Map<number, Record<CompKey, number>>();
  for (let q = 1; q <= 4; q++) {
    compByQ.set(q, { developer: 0, design_consultant: 0, main_contractor: 0, other: 0 });
  }
  for (const r of levelRows) {
    if (!r.is_forward || !r.is_credited) continue;
    const bucket: CompKey =
      r.company_type_at_time === 'developer'
        ? 'developer'
        : r.company_type_at_time === 'design_consultant'
          ? 'design_consultant'
          : r.company_type_at_time === 'main_contractor'
            ? 'main_contractor'
            : 'other';
    const c = compByQ.get(r.fiscal_quarter);
    if (c) c[bucket]++;
  }

  // Engagement freshness: count per Q from engagement_date
  const engByQ = new Map<number, number>([
    [1, 0], [2, 0], [3, 0], [4, 0],
  ]);
  for (const e of engagements) {
    const month = parseInt(e.engagement_date.slice(5, 7), 10);
    const q = Math.ceil(month / 3);
    engByQ.set(q, (engByQ.get(q) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-agsi-darkGray hover:underline">
          ← Reports
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-agsi-navy">{subject.full_name}</h1>
          <Badge variant={subject.role === 'bd_head' ? 'blue' : 'neutral'}>
            {ROLE_LABEL[subject.role]}
          </Badge>
          {!subject.is_active && <Badge variant="red">Deactivated</Badge>}
        </div>
        <p className="mt-1 text-sm text-agsi-darkGray">
          {subject.email} · Performance review FY{fy}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>BEI by quarter</CardTitle>
          <CardDescription>
            Bonus Eligibility Index across the year. Tier transitions show how performance
            is trending; see the per-driver breakdown below for what&apos;s moving.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                <th className="px-4 py-2 font-medium">Quarter</th>
                <th className="px-4 py-2 font-medium tabular">A</th>
                <th className="px-4 py-2 font-medium tabular">B</th>
                <th className="px-4 py-2 font-medium tabular">C</th>
                <th className="px-4 py-2 font-medium tabular">D</th>
                <th className="px-4 py-2 font-medium tabular">BEI</th>
                <th className="px-4 py-2 font-medium">Tier</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((q) => {
                const b = beiByQ.get(q);
                return (
                  <tr key={q} className="border-b border-agsi-lightGray/50">
                    <td className="px-4 py-3 font-medium text-agsi-navy">Q{q}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
                      {b?.driver_a_pct == null ? '—' : `${Math.round(Number(b.driver_a_pct) * 100)}%`}
                    </td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
                      {b?.driver_b_pct == null ? '—' : `${Math.round(Number(b.driver_b_pct) * 100)}%`}
                    </td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
                      {b?.driver_c_pct == null ? '—' : `${Math.round(Number(b.driver_c_pct) * 100)}%`}
                    </td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
                      {b?.driver_d_pct == null ? '—' : `${Math.round(Number(b.driver_d_pct) * 100)}%`}
                    </td>
                    <td className="px-4 py-3 tabular font-semibold text-agsi-navy">
                      {b?.bei == null ? '—' : `${Math.round(Number(b.bei) * 100)}%`}
                    </td>
                    <td className="px-4 py-3">
                      {b?.bei_tier ? (
                        <Badge variant={TIER_VARIANT[b.bei_tier] ?? 'neutral'}>
                          {TIER_LABEL[b.bei_tier] ?? b.bei_tier}
                        </Badge>
                      ) : (
                        <span className="text-xs text-agsi-darkGray">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {(['A', 'B', 'C', 'D'] as Driver[]).map((d) => (
        <Card key={d}>
          <CardHeader>
            <CardTitle>{DRIVER_LABEL[d]}</CardTitle>
            <CardDescription>Q1–Q4 actuals vs target. Override values are marked.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {grouped[d].length === 0 ? (
              <p className="p-6 text-sm text-agsi-darkGray">No metrics seeded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                    <th className="px-4 py-2 font-medium">Metric</th>
                    {[1, 2, 3, 4].map((q) => (
                      <th key={q} colSpan={2} className="border-l border-agsi-lightGray/50 px-2 py-2 text-center font-medium">
                        Q{q}
                      </th>
                    ))}
                    <th className="border-l border-agsi-lightGray/50 px-4 py-2 font-medium">FY</th>
                  </tr>
                  <tr className="border-b border-agsi-lightGray text-left text-xs text-agsi-darkGray">
                    <th></th>
                    {[1, 2, 3, 4].map((q) => (
                      <>
                        <th key={`${q}-actual`} className="border-l border-agsi-lightGray/50 px-2 py-1 tabular">A</th>
                        <th key={`${q}-target`} className="px-2 py-1 tabular">T</th>
                      </>
                    ))}
                    <th className="border-l border-agsi-lightGray/50 px-4 py-1 tabular">A / T</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[d].map((m) => {
                    const override = overrideByMetric.has(m.metric_code);
                    const actualFY = [1, 2, 3, 4].reduce((s, q) => s + actualFor(m.metric_code, q), 0);
                    const targetFY = [1, 2, 3, 4].reduce((s, q) => s + targetFor(m, q), 0);
                    return (
                      <tr key={m.metric_code} className="border-b border-agsi-lightGray/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-agsi-navy">{m.metric_label}</div>
                          {override && <Badge variant="purple" className="mt-1">override</Badge>}
                        </td>
                        {[1, 2, 3, 4].map((q) => {
                          const a = actualFor(m.metric_code, q);
                          const t = targetFor(m, q);
                          return (
                            <>
                              <td
                                key={`${q}-a`}
                                className={`border-l border-agsi-lightGray/50 px-2 py-3 tabular ${
                                  ragVariant(a, t) === 'red'
                                    ? 'text-rag-red'
                                    : ragVariant(a, t) === 'amber'
                                      ? 'text-rag-amber'
                                      : ragVariant(a, t) === 'green'
                                        ? 'text-agsi-green'
                                        : 'text-agsi-navy'
                                }`}
                              >
                                {a}
                              </td>
                              <td key={`${q}-t`} className="px-2 py-3 tabular text-agsi-darkGray">
                                {t}
                              </td>
                            </>
                          );
                        })}
                        <td className="border-l border-agsi-lightGray/50 px-4 py-3 tabular text-agsi-darkGray">
                          <span className="text-agsi-navy">{actualFY}</span> / {targetFY}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Stakeholder composition (forward credited moves)</CardTitle>
          <CardDescription>
            Per quarter, how the BDM&apos;s forward-credited level changes broke down by
            stakeholder type. Helps spot over- or under-indexing on developers vs
            consultants vs contractors.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                <th className="px-4 py-2 font-medium">Quarter</th>
                <th className="px-4 py-2 font-medium tabular">Developer</th>
                <th className="px-4 py-2 font-medium tabular">Design Consultant</th>
                <th className="px-4 py-2 font-medium tabular">Main Contractor</th>
                <th className="px-4 py-2 font-medium tabular">Other</th>
                <th className="px-4 py-2 font-medium tabular">Total</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((q) => {
                const c = compByQ.get(q)!;
                const total = c.developer + c.design_consultant + c.main_contractor + c.other;
                return (
                  <tr key={q} className="border-b border-agsi-lightGray/50">
                    <td className="px-4 py-3 font-medium text-agsi-navy">Q{q}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{c.developer}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{c.design_consultant}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{c.main_contractor}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{c.other}</td>
                    <td className="px-4 py-3 tabular font-semibold text-agsi-navy">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Engagement freshness</CardTitle>
          <CardDescription>
            Engagements logged per quarter (any type). M13 will surface days-since-last
            per company; this is the volume view.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                <th className="px-4 py-2 font-medium">Quarter</th>
                <th className="px-4 py-2 font-medium tabular">Engagements logged</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((q) => (
                <tr key={q} className="border-b border-agsi-lightGray/50">
                  <td className="px-4 py-3 font-medium text-agsi-navy">Q{q}</td>
                  <td className="px-4 py-3 tabular text-agsi-darkGray">{engByQ.get(q) ?? 0}</td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-3 font-medium text-agsi-navy">Total</td>
                <td className="px-4 py-3 tabular font-semibold text-agsi-navy">
                  {engagements.length}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Level transitions</CardTitle>
          <CardDescription>
            Every level change credited to {subject.full_name} this FY. Backward and
            uncredited rows surface for full audit context.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {levelRows.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No level changes credited this FY.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Move</th>
                  <th className="px-4 py-2 font-medium">FY/Q</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {levelRows.map((r) => (
                  <tr key={r.id} className="border-b border-agsi-lightGray/50">
                    <td className="px-4 py-3 text-agsi-darkGray">
                      {new Date(r.changed_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {r.company ? (
                        <Link
                          href={`/companies/${r.company.id}`}
                          className="font-medium text-agsi-navy hover:underline"
                        >
                          {r.company.canonical_name}
                        </Link>
                      ) : (
                        <span className="italic text-agsi-darkGray">deleted</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">
                      {COMPANY_TYPE_LABEL[r.company_type_at_time] ?? r.company_type_at_time}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <LevelBadge level={r.from_level} />
                        <span className="text-agsi-darkGray">→</span>
                        <LevelBadge level={r.to_level} />
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
                      {r.fiscal_year} Q{r.fiscal_quarter}
                    </td>
                    <td className="px-4 py-3">
                      {!r.is_forward && <Badge variant="amber">Backward</Badge>}
                      {r.is_forward && r.is_credited && <Badge variant="green">Credited</Badge>}
                      {r.is_forward && !r.is_credited && (
                        <Badge variant="neutral">Uncredited</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.evidence_note ? (
                        <span className="line-clamp-2 max-w-xs text-xs text-agsi-darkGray">
                          {r.evidence_note}
                        </span>
                      ) : (
                        <span className="text-xs text-agsi-darkGray">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
