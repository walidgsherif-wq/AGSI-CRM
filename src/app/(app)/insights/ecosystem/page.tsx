import Link from 'next/link';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { type Level } from '@/types/domain';
import {
  getEcosystemSummary,
  type ContributorRow,
  type CoolingRow,
  type EcosystemSnapshot,
} from '@/server/actions/ecosystem';
import { EcosystemTrendChart } from './_components/EcosystemTrendChart';
import { SegmentationView } from './_components/SegmentationView';

export const dynamic = 'force-dynamic';

export default async function EcosystemInsightsPage() {
  await requireRole(['admin', 'leadership', 'bd_head']);

  const summary = await getEcosystemSummary(120, 10, 10);
  if ('error' in summary) {
    return (
      <p className="text-sm text-rag-red">Could not load ecosystem data: {summary.error}</p>
    );
  }

  const { snapshot, trend, topContributors, cooling } = summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Ecosystem awareness</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Hybrid lifetime + active (90-day) score for AGSI&apos;s reach across the
          789-stakeholder UAE construction universe. Leadership-only — never visible to
          BD managers.
        </p>
      </div>

      {!snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle>No snapshot yet</CardTitle>
            <CardDescription>
              The ecosystem awareness rollup hasn&apos;t been computed.{' '}
              <Link
                href={'/admin/ecosystem-rebuild' as never}
                className="text-agsi-accent hover:underline"
              >
                Admin → Ecosystem → Run backfill / Rebuild now
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <HeroBlock snapshot={snapshot} />

          {trend.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Active score trend</CardTitle>
                <CardDescription>
                  Daily active-score snapshots, last {trend.length} days. Captures whether
                  ecosystem warmth is growing, stable, or cooling.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EcosystemTrendChart trend={trend} />
              </CardContent>
            </Card>
          )}

          <SegmentationView snapshot={snapshot} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TopContributors rows={topContributors} />
            <CoolingAccounts rows={cooling} />
          </div>
        </>
      )}
    </div>
  );
}

function HeroBlock({ snapshot }: { snapshot: EcosystemSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hero panel</CardTitle>
        <CardDescription>
          Snapshot {snapshot.snapshot_date}. Theoretical max ={' '}
          <span className="tabular-nums">{fmt(snapshot.theoretical_max)}</span> ={' '}
          789-stakeholder universe × 100 max points each (§3.16).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <HeroStat
            label="Active (last 90 days)"
            value={fmt(snapshot.active_score)}
            denominator={fmt(snapshot.theoretical_max)}
            pct={snapshot.active_pct}
            tone="green"
            hint="AGSI is currently warm with…"
          />
          <HeroStat
            label="Lifetime"
            value={fmt(snapshot.lifetime_score)}
            denominator={fmt(snapshot.theoretical_max)}
            pct={snapshot.lifetime_pct}
            tone="navy"
            hint="AGSI has ever touched…"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function HeroStat({
  label,
  value,
  denominator,
  pct,
  tone,
  hint,
}: {
  label: string;
  value: string;
  denominator: string;
  pct: number;
  tone: 'green' | 'navy';
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p
        className={`mt-2 text-4xl font-semibold tabular-nums ${
          tone === 'green' ? 'text-agsi-green' : 'text-agsi-navy'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-sm text-agsi-darkGray">
        of <span className="tabular-nums">{denominator}</span> theoretical max{' '}
        <span className="ml-2 font-medium text-agsi-navy">({fmtPct(pct)}%)</span>
      </p>
      <p className="mt-2 text-xs italic text-agsi-darkGray">&ldquo;{hint}&rdquo;</p>
    </div>
  );
}

function TopContributors({ rows }: { rows: ContributorRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top contributors this period</CardTitle>
        <CardDescription>
          Companies that earned the most active-window points. Shows where momentum is
          building.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-4 text-sm text-agsi-darkGray">
            No active points in the window yet.
          </p>
        ) : (
          <ul className="divide-y divide-agsi-lightGray">
            {rows.map((r) => (
              <li key={r.company_id} className="flex items-center justify-between px-4 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/companies/${r.company_id}`}
                    className="text-sm font-medium text-agsi-navy hover:underline"
                  >
                    {r.canonical_name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    {r.current_level && <LevelBadge level={r.current_level as Level} />}
                    {r.company_type && (
                      <span className="text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[r.company_type as keyof typeof COMPANY_TYPE_LABEL] ??
                          r.company_type}
                      </span>
                    )}
                  </div>
                </div>
                <span className="ml-3 tabular-nums text-sm font-semibold text-agsi-green">
                  +{fmt(r.active_points)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CoolingAccounts({ rows }: { rows: CoolingRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cooling accounts</CardTitle>
        <CardDescription>
          High lifetime score, zero active score in the window. Refresh-campaign
          candidates.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-4 text-sm text-agsi-darkGray">
            No cooling accounts — every touched company has activity in the window.
          </p>
        ) : (
          <ul className="divide-y divide-agsi-lightGray">
            {rows.map((r) => (
              <li key={r.company_id} className="flex items-center justify-between px-4 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/companies/${r.company_id}`}
                    className="text-sm font-medium text-agsi-navy hover:underline"
                  >
                    {r.canonical_name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    {r.current_level && <LevelBadge level={r.current_level as Level} />}
                    {r.company_type && (
                      <span className="text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[r.company_type as keyof typeof COMPANY_TYPE_LABEL] ??
                          r.company_type}
                      </span>
                    )}
                    {r.last_event_at && (
                      <Badge variant="amber">
                        last touch {new Date(r.last_event_at).toISOString().slice(0, 10)}
                      </Badge>
                    )}
                  </div>
                </div>
                <span className="ml-3 tabular-nums text-sm text-agsi-darkGray">
                  {fmt(r.lifetime_points)} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}
