import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataFreshnessBadge } from '@/components/domain/DataFreshnessBadge';
import { EmptyState } from '@/components/ui/empty-state';
import { SnapshotPicker } from './_components/SnapshotPicker';
import { TrendCharts, type TrendPoint, type PricePoint } from './_components/TrendCharts';

export const dynamic = 'force-dynamic';

type SnapshotDate = { snapshot_date: string };

type Row = {
  metric_code: string;
  dimension_key: string;
  metric_value: number | null;
  metric_value_json: Record<string, unknown> | null;
};

type UploadRef = {
  id: string;
  filename: string;
  file_date: string;
  uploaded_at: string;
  status: string;
};

const STAGE_ORDER = [
  'concept',
  'design',
  'tender',
  'tender_submission',
  'tender_evaluation',
  'under_construction',
  'completed',
  'on_hold',
  'cancelled',
];

const STAGE_LABEL: Record<string, string> = {
  concept: 'Concept',
  design: 'Design',
  tender: 'Tender',
  tender_submission: 'Tender — Submission',
  tender_evaluation: 'Tender — Evaluation',
  under_construction: 'Under construction',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: { snapshot?: string; compare?: string };
}) {
  await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Available snapshot dates.
  const { data: datesRaw } = await supabase
    .from('market_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(50)
    .returns<SnapshotDate[]>();

  const allDates = Array.from(
    new Set((datesRaw ?? []).map((d) => d.snapshot_date)),
  );

  if (allDates.length === 0) {
    return <InsightsEmpty />;
  }

  const primary = searchParams.snapshot && allDates.includes(searchParams.snapshot)
    ? searchParams.snapshot
    : allDates[0];
  const compare =
    searchParams.compare && allDates.includes(searchParams.compare) && searchParams.compare !== primary
      ? searchParams.compare
      : null;

  const fetchSnapshot = async (date: string): Promise<Row[]> => {
    const { data } = await supabase
      .from('market_snapshots')
      .select('metric_code, dimension_key, metric_value, metric_value_json')
      .eq('snapshot_date', date)
      .returns<Row[]>();
    return data ?? [];
  };

  const [primaryData, compareData, uploadRefs, trendRows, priceRows] = await Promise.all([
    fetchSnapshot(primary),
    compare ? fetchSnapshot(compare) : Promise.resolve<Row[]>([]),
    supabase
      .from('bnc_uploads')
      .select('id, filename, file_date, uploaded_at, status')
      .in('file_date', compare ? [primary, compare] : [primary])
      .returns<UploadRef[]>(),
    // Trend dataset — only the metric_codes we plot, across all snapshot dates.
    supabase
      .from('market_snapshots')
      .select('snapshot_date, metric_code, dimension_key, metric_value_json')
      .in('metric_code', ['projects_by_stage', 'rebar_window'])
      .order('snapshot_date', { ascending: true })
      .returns<
        Array<{
          snapshot_date: string;
          metric_code: string;
          dimension_key: string;
          metric_value_json: Record<string, unknown> | null;
        }>
      >(),
    // Rebar price history.
    supabase
      .from('rebar_price_history')
      .select('effective_month, price_aed_per_tonne')
      .order('effective_month', { ascending: true })
      .returns<Array<{ effective_month: string; price_aed_per_tonne: number }>>(),
  ]);

  const refs = new Map((uploadRefs.data ?? []).map((u) => [u.file_date, u]));
  const primaryRef = refs.get(primary);
  const compareRef = compare ? refs.get(compare) : undefined;

  const p = group(primaryData);
  const c = compare ? group(compareData) : null;

  // Build trend series: per snapshot_date, value-pre-construction +
  // value-under-construction + rebar tonnes.
  const PRE_CONSTRUCTION_STAGES = new Set([
    'concept',
    'design',
    'tender',
    'tender_evaluation',
    'tender_submission',
  ]);
  const trendByDate = new Map<string, TrendPoint>();
  for (const r of trendRows.data ?? []) {
    const date = r.snapshot_date;
    let entry = trendByDate.get(date);
    if (!entry) {
      entry = {
        snapshot_date: date,
        pre_construction_aed: 0,
        under_construction_aed: 0,
        rebar_tonnes: 0,
      };
      trendByDate.set(date, entry);
    }
    if (r.metric_code === 'projects_by_stage') {
      const v = Number(
        (r.metric_value_json as { value_aed?: number } | null)?.value_aed ?? 0,
      );
      if (PRE_CONSTRUCTION_STAGES.has(r.dimension_key)) {
        entry.pre_construction_aed += v;
      } else if (r.dimension_key === 'under_construction') {
        entry.under_construction_aed += v;
      }
    } else if (r.metric_code === 'rebar_window') {
      const j = r.metric_value_json as
        | { in_window?: { remaining_rebar_tonnes?: number } }
        | null;
      entry.rebar_tonnes = Number(j?.in_window?.remaining_rebar_tonnes ?? 0);
    }
  }
  const trendData = Array.from(trendByDate.values()).sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date),
  );

  const priceData: PricePoint[] = (priceRows.data ?? []).map((r) => ({
    effective_month: r.effective_month.slice(0, 7),
    price_aed_per_tonne: Number(r.price_aed_per_tonne),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Market insights</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Pre-computed market snapshots from BNC uploads. Pick a snapshot date to view,
            and optionally a second to diff against.
          </p>
          <div className="mt-2">
            <DataFreshnessBadge
              asOf={primary}
              refreshedAt={primaryRef?.uploaded_at}
            />
          </div>
        </div>
        <SnapshotPicker
          dates={allDates}
          primary={primary}
          compare={compare}
        />
      </div>

      <FreshnessRow primary={primaryRef} compare={compareRef} />

      <TrendCharts trend={trendData} prices={priceData} />

      <div className="grid gap-4 lg:grid-cols-2">
        <StageFunnelCard primary={p.stage_funnel} compare={c?.stage_funnel} />
        <ProjectsByStageCard primary={p.projects_by_stage} compare={c?.projects_by_stage} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionCard
          title="Projects by city"
          rows={p.projects_by_city}
          compareRows={c?.projects_by_city}
          limit={15}
        />
        <DimensionCard
          title="Projects by sector"
          rows={p.projects_by_sector}
          compareRows={c?.projects_by_sector}
          limit={12}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopCompaniesCard
          title="Top 20 developers"
          rows={p.top_developer}
          compareRows={c?.top_developer}
          countKey="project_count"
        />
        <TopCompaniesCard
          title="Top 20 main contractors"
          rows={p.top_main_contractor}
          compareRows={c?.top_main_contractor}
          countKey="active_project_count"
        />
        <TopCompaniesCard
          title="Top 20 consultants"
          rows={p.top_consultant}
          compareRows={c?.top_consultant}
          countKey="active_project_count"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AwardedBreakdownCard primary={p.awarded_breakdown} compare={c?.awarded_breakdown} />
        <CompletionPipelineCard
          primary={p.completion_pipeline}
          compare={c?.completion_pipeline}
        />
      </div>

      <ConstructionAvgCard
        primary={p.construction_value_avg?.[0]}
        compare={c?.construction_value_avg?.[0]}
      />

      <RebarWindowSection
        primary={p.rebar_window?.[0]}
        compare={c?.rebar_window?.[0]}
        topRows={p.top_rebar_window_projects}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function group(rows: Row[]): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const r of rows) {
    out[r.metric_code] = out[r.metric_code] ?? [];
    out[r.metric_code].push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cards

function InsightsEmpty() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Market insights</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          No market snapshot has been generated yet.
        </p>
      </div>
      <EmptyState
        icon="MS"
        title="No market snapshot yet"
        description="Generate a snapshot from the most recent completed BNC upload via Admin → BNC Uploads → open the upload → Generate market snapshot."
        action={{ label: 'Open BNC Uploads', href: '/admin/uploads' }}
      />
    </div>
  );
}

function FreshnessRow({
  primary,
  compare,
}: {
  primary: UploadRef | undefined;
  compare: UploadRef | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {primary && (
        <Badge variant="blue">
          Primary · file {primary.file_date} · uploaded{' '}
          {new Date(primary.uploaded_at).toISOString().slice(0, 10)}
        </Badge>
      )}
      {compare && (
        <Badge variant="amber">
          Compare · file {compare.file_date} · uploaded{' '}
          {new Date(compare.uploaded_at).toISOString().slice(0, 10)}
        </Badge>
      )}
    </div>
  );
}

function StageFunnelCard({
  primary,
  compare,
}: {
  primary?: Row[];
  compare?: Row[];
}) {
  const ordered = STAGE_ORDER.map((s) => ({
    stage: s,
    primary: numFromMetric(primary?.find((r) => r.dimension_key === s)),
    compare: compare ? numFromMetric(compare.find((r) => r.dimension_key === s)) : null,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage funnel</CardTitle>
        <CardDescription>Project count by canonical pipeline stage.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {ordered.map((row) => (
            <li
              key={row.stage}
              className="flex items-center justify-between border-b border-agsi-lightGray py-1 last:border-b-0"
            >
              <span className="text-agsi-darkGray">{STAGE_LABEL[row.stage] ?? row.stage}</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="font-semibold text-agsi-navy">{fmt(row.primary)}</span>
                {compare && row.compare != null && (
                  <DiffBadge cur={row.primary} prev={row.compare} />
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ProjectsByStageCard({
  primary,
  compare,
}: {
  primary?: Row[];
  compare?: Row[];
}) {
  const cur = STAGE_ORDER.map((s) => {
    const j = primary?.find((r) => r.dimension_key === s)?.metric_value_json as
      | { count?: number; value_aed?: number }
      | undefined;
    const prev = compare?.find((r) => r.dimension_key === s)?.metric_value_json as
      | { count?: number; value_aed?: number }
      | undefined;
    return {
      stage: s,
      count: Number(j?.count ?? 0),
      value: Number(j?.value_aed ?? 0),
      prevCount: prev ? Number(prev.count ?? 0) : null,
    };
  }).filter((r) => r.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects by stage (with value)</CardTitle>
        <CardDescription>Total deal value AED per pipeline stage.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {cur.length === 0 ? (
            <li className="text-agsi-darkGray">No data.</li>
          ) : (
            cur.map((r) => (
              <li
                key={r.stage}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-agsi-lightGray py-1 last:border-b-0"
              >
                <span className="text-agsi-darkGray">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                <span className="text-right tabular-nums text-agsi-navy">
                  {fmt(r.count)}
                  {compare && r.prevCount != null && (
                    <DiffBadge cur={r.count} prev={r.prevCount} />
                  )}
                </span>
                <span className="text-right tabular-nums text-agsi-darkGray">
                  {fmtCurrency(r.value)}
                </span>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function DimensionCard({
  title,
  rows,
  compareRows,
  limit,
}: {
  title: string;
  rows?: Row[];
  compareRows?: Row[];
  limit: number;
}) {
  const compareLookup = new Map<string, number>();
  for (const r of compareRows ?? []) {
    const v = (r.metric_value_json as { count?: number } | null)?.count;
    if (v != null) compareLookup.set(r.dimension_key, Number(v));
  }

  const sorted = (rows ?? [])
    .map((r) => {
      const j = r.metric_value_json as
        | { count?: number; value_aed?: number }
        | null;
      return {
        key: r.dimension_key,
        count: Number(j?.count ?? 0),
        value: Number(j?.value_aed ?? 0),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Top {limit} by project count.</CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-agsi-darkGray">No data.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {sorted.map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between border-b border-agsi-lightGray py-1 last:border-b-0"
              >
                <span className="truncate text-agsi-darkGray" title={r.key}>
                  {r.key}
                </span>
                <span className="ml-2 flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-agsi-navy">{fmt(r.count)}</span>
                  {compareRows && compareLookup.has(r.key) && (
                    <DiffBadge cur={r.count} prev={compareLookup.get(r.key) ?? 0} />
                  )}
                  <span className="text-xs text-agsi-darkGray">
                    {r.value > 0 ? fmtCurrency(r.value) : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TopCompaniesCard({
  title,
  rows,
  compareRows,
  countKey,
}: {
  title: string;
  rows?: Row[];
  compareRows?: Row[];
  countKey: 'project_count' | 'active_project_count';
}) {
  const compareLookup = new Map<string, number>();
  for (const r of compareRows ?? []) {
    const j = r.metric_value_json as Record<string, unknown> | null;
    const v = j?.[countKey];
    if (v != null) compareLookup.set(r.dimension_key, Number(v));
  }

  const sorted = (rows ?? [])
    .map((r) => {
      const j = r.metric_value_json as
        | { company_name?: string; value_aed?: number }
        | null;
      return {
        id: r.dimension_key,
        name: String(j?.company_name ?? '(unnamed)'),
        count: Number((r.metric_value_json as Record<string, unknown> | null)?.[countKey] ?? 0),
        value: Number(j?.value_aed ?? 0),
      };
    })
    .sort((a, b) => b.count - a.count);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>By project count and total value.</CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-agsi-darkGray">No data.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {sorted.map((r, i) => (
              <li
                key={r.id}
                className="flex items-center justify-between border-b border-agsi-lightGray py-1 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-xs text-agsi-darkGray">{i + 1}.</span>
                  <Link
                    href={`/companies/${r.id}`}
                    className="truncate text-agsi-navy hover:underline"
                    title={r.name}
                  >
                    {r.name}
                  </Link>
                </span>
                <span className="ml-2 flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-agsi-navy">{r.count}</span>
                  {compareRows && compareLookup.has(r.id) && (
                    <DiffBadge cur={r.count} prev={compareLookup.get(r.id) ?? 0} />
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function AwardedBreakdownCard({
  primary,
  compare,
}: {
  primary?: Row[];
  compare?: Row[];
}) {
  function pick(rows: Row[] | undefined, key: 'awarded' | 'not_awarded') {
    const j = rows?.find((r) => r.dimension_key === key)?.metric_value_json as
      | { count?: number; value_aed?: number }
      | undefined;
    return { count: Number(j?.count ?? 0), value: Number(j?.value_aed ?? 0) };
  }
  const a = pick(primary, 'awarded');
  const n = pick(primary, 'not_awarded');
  const aPrev = compare ? pick(compare, 'awarded').count : null;
  const nPrev = compare ? pick(compare, 'not_awarded').count : null;
  const total = a.count + n.count;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Awarded vs not-awarded</CardTitle>
        <CardDescription>
          Awarded = a current main_contractor link is set on the project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat
            label="Awarded"
            value={a.count}
            suffix={total > 0 ? `${pct(a.count, total)}%` : ''}
            cur={a.count}
            prev={aPrev}
          />
          <Stat
            label="Not awarded"
            value={n.count}
            suffix={total > 0 ? `${pct(n.count, total)}%` : ''}
            cur={n.count}
            prev={nPrev}
          />
        </div>
        <p className="mt-3 text-xs text-agsi-darkGray">
          Total project value: {fmtCurrency(a.value + n.value)} AED.
        </p>
      </CardContent>
    </Card>
  );
}

function CompletionPipelineCard({
  primary,
  compare,
}: {
  primary?: Row[];
  compare?: Row[];
}) {
  const buckets: Array<{ key: string; label: string }> = [
    { key: '12mo', label: 'Next 12 mo' },
    { key: '24mo', label: 'Next 24 mo' },
    { key: '36mo', label: 'Next 36 mo' },
    { key: '36mo_plus', label: '36+ mo' },
    { key: 'unknown', label: 'Unknown date' },
  ];
  function pick(rows: Row[] | undefined, key: string) {
    const j = rows?.find((r) => r.dimension_key === key)?.metric_value_json as
      | { count?: number }
      | undefined;
    return Number(j?.count ?? 0);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Completion pipeline</CardTitle>
        <CardDescription>Projects expected to complete within window.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {buckets.map((b) => {
            const cur = pick(primary, b.key);
            const prev = compare ? pick(compare, b.key) : null;
            return (
              <li
                key={b.key}
                className="flex items-center justify-between border-b border-agsi-lightGray py-1 last:border-b-0"
              >
                <span className="text-agsi-darkGray">{b.label}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-agsi-navy">{cur}</span>
                  {compare && prev != null && <DiffBadge cur={cur} prev={prev} />}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ConstructionAvgCard({
  primary,
  compare,
}: {
  primary?: Row;
  compare?: Row;
}) {
  const j = primary?.metric_value_json as
    | {
        project_count?: number;
        avg_completion_pct?: number;
        avg_value_aed?: number;
        total_value_aed?: number;
      }
    | undefined;
  const jc = compare?.metric_value_json as typeof j | undefined;

  if (!j || !j.project_count) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Under-construction value</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-agsi-darkGray">
            No under-construction projects in this snapshot.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Under-construction value</CardTitle>
        <CardDescription>
          Average completion % and value among projects in stage{' '}
          <code>under_construction</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Project count"
            value={Number(j.project_count)}
            cur={Number(j.project_count)}
            prev={jc ? Number(jc.project_count ?? 0) : null}
          />
          <Stat
            label="Avg completion %"
            value={Number(j.avg_completion_pct).toFixed(1)}
            cur={Number(j.avg_completion_pct)}
            prev={jc ? Number(jc.avg_completion_pct ?? 0) : null}
          />
          <Stat
            label="Avg value AED"
            value={fmtCurrency(Number(j.avg_value_aed))}
            cur={Number(j.avg_value_aed)}
            prev={jc ? Number(jc.avg_value_aed ?? 0) : null}
          />
          <Stat
            label="Total value AED"
            value={fmtCurrency(Number(j.total_value_aed))}
            cur={Number(j.total_value_aed)}
            prev={jc ? Number(jc.total_value_aed ?? 0) : null}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RebarWindowSection({
  primary,
  compare,
  topRows,
}: {
  primary?: Row;
  compare?: Row;
  topRows?: Row[];
}) {
  type Bucket = { count?: number; value_aed?: number };
  type Json = {
    threshold_pct?: number;
    in_window?: Bucket;
    past_window?: Bucket;
    unknown_completion?: Bucket;
  };

  const j = primary?.metric_value_json as Json | undefined;
  const jc = compare?.metric_value_json as Json | undefined;

  if (!j) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rebar consumption window</CardTitle>
          <CardDescription>
            Re-run <strong>Generate market snapshot</strong> to populate this section.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-agsi-darkGray">
            This snapshot was generated before migration <code>0041</code>. Open Admin →
            BNC Uploads → the upload for this snapshot date → Generate market snapshot to
            refresh.
          </p>
        </CardContent>
      </Card>
    );
  }

  const threshold = Number(j.threshold_pct ?? 45);
  const inWin = j.in_window ?? {};
  const past = j.past_window ?? {};
  const unk = j.unknown_completion ?? {};
  const inWinPrev = jc?.in_window;
  const pastPrev = jc?.past_window;
  const unkPrev = jc?.unknown_completion;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rebar consumption window</CardTitle>
        <CardDescription>
          Rebar is consumed during the first <strong>{threshold}%</strong> of construction.
          Projects under construction below that threshold are still in the active rebar
          buying window — the addressable opportunity. Threshold is configurable via{' '}
          <code>app_settings.rebar_consumption_window_pct</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={`In window (< ${threshold}%)`}
            value={fmt(Number(inWin.count ?? 0))}
            suffix={Number(inWin.value_aed ?? 0) > 0 ? `${fmtCurrency(Number(inWin.value_aed))} AED` : ''}
            cur={Number(inWin.count ?? 0)}
            prev={inWinPrev ? Number(inWinPrev.count ?? 0) : null}
          />
          <Stat
            label={`Past window (≥ ${threshold}%)`}
            value={fmt(Number(past.count ?? 0))}
            suffix={Number(past.value_aed ?? 0) > 0 ? `${fmtCurrency(Number(past.value_aed))} AED` : ''}
            cur={Number(past.count ?? 0)}
            prev={pastPrev ? Number(pastPrev.count ?? 0) : null}
          />
          <Stat
            label="Unknown completion"
            value={fmt(Number(unk.count ?? 0))}
            suffix={Number(unk.value_aed ?? 0) > 0 ? `${fmtCurrency(Number(unk.value_aed))} AED` : ''}
            cur={Number(unk.count ?? 0)}
            prev={unkPrev ? Number(unkPrev.count ?? 0) : null}
          />
        </div>

        {topRows && topRows.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
              Top {topRows.length} in-window projects by value
            </p>
            <ul className="space-y-1 text-sm">
              {topRows
                .map((r) => ({
                  id: r.dimension_key,
                  j: r.metric_value_json as
                    | {
                        project_name?: string;
                        city?: string;
                        sector?: string;
                        completion_pct?: number;
                        value_aed?: number;
                        estimated_completion_date?: string | null;
                      }
                    | null,
                }))
                .sort((a, b) => Number(b.j?.value_aed ?? 0) - Number(a.j?.value_aed ?? 0))
                .map((r, i) => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-3 border-b border-agsi-lightGray py-1 last:border-b-0"
                  >
                    <span className="text-xs text-agsi-darkGray">{i + 1}.</span>
                    <Link
                      href={`/projects/${r.id}`}
                      className="truncate text-agsi-navy hover:underline"
                      title={r.j?.project_name ?? '(unnamed)'}
                    >
                      {r.j?.project_name ?? '(unnamed)'}
                      <span className="ml-2 text-xs text-agsi-darkGray">
                        {r.j?.city ?? ''}
                        {r.j?.sector ? ` · ${r.j.sector}` : ''}
                      </span>
                    </Link>
                    <span className="text-right tabular-nums text-xs text-agsi-darkGray">
                      {Number(r.j?.completion_pct ?? 0).toFixed(0)}% complete
                    </span>
                    <span className="text-right tabular-nums font-semibold text-agsi-navy">
                      {fmtCurrency(Number(r.j?.value_aed ?? 0))} AED
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-xs italic text-agsi-darkGray">
              These are the open-rebar opportunities to chase. BD priority list.
            </p>
          </div>
        ) : (
          <p className="text-xs text-agsi-darkGray">
            No projects with known completion below {threshold}% in this snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix,
  cur,
  prev,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  cur?: number;
  prev?: number | null;
}) {
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-agsi-darkGray">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-agsi-navy">
        {value}
        {suffix ? <span className="ml-1 text-xs text-agsi-darkGray">{suffix}</span> : null}
      </p>
      {cur != null && prev != null && (
        <div className="mt-1">
          <DiffBadge cur={cur} prev={prev} />
        </div>
      )}
    </div>
  );
}

function DiffBadge({ cur, prev }: { cur: number; prev: number }) {
  const diff = cur - prev;
  if (diff === 0) return <span className="text-[10px] text-agsi-darkGray">±0</span>;
  const tone = diff > 0 ? 'text-agsi-green' : 'text-rag-red';
  const sign = diff > 0 ? '+' : '';
  return (
    <span className={`text-[10px] font-medium tabular-nums ${tone}`}>
      {sign}
      {diff}
    </span>
  );
}

function numFromMetric(r: Row | undefined): number {
  if (!r) return 0;
  if (r.metric_value != null) return Number(r.metric_value);
  return 0;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function pct(part: number, total: number): string {
  return ((part / total) * 100).toFixed(0);
}
