import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getEcosystemSummary } from '@/server/actions/ecosystem';
import { EcosystemTrendSpark } from './EcosystemTrendSpark';

/**
 * Compact ecosystem awareness panel for the dashboard.
 * Visible only to admin / leadership / bd_head — caller decides via
 * conditional render. RLS additionally hides the data from bd_manager.
 */
export async function EcosystemPanel() {
  const summary = await getEcosystemSummary(30, 0, 0);

  if ('error' in summary) {
    return null;
  }

  const { snapshot, trend } = summary;

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ecosystem awareness</CardTitle>
          <CardDescription>
            No snapshot yet — admin can run the rebuild from{' '}
            <Link
              href={'/admin/ecosystem-rebuild' as never}
              className="text-agsi-accent hover:underline"
            >
              Admin → Ecosystem
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Ecosystem awareness</CardTitle>
            <CardDescription>
              Active vs lifetime brand reach across the 789-stakeholder universe.
            </CardDescription>
          </div>
          <Link
            href={'/insights/ecosystem' as never}
            className="text-xs font-medium text-agsi-accent hover:underline"
          >
            Open full view →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Active (last 90 days)"
            value={fmt(snapshot.active_score)}
            denominator={fmt(snapshot.theoretical_max)}
            pct={snapshot.active_pct}
            tone="green"
          />
          <Stat
            label="Lifetime"
            value={fmt(snapshot.lifetime_score)}
            denominator={fmt(snapshot.theoretical_max)}
            pct={snapshot.lifetime_pct}
            tone="navy"
          />
        </div>
        {trend.length > 1 && (
          <div className="mt-4">
            <p className="mb-1 text-xs text-agsi-darkGray">Active score, last 30 days</p>
            <EcosystemTrendSpark trend={trend} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  denominator,
  pct,
  tone,
}: {
  label: string;
  value: string;
  denominator: string;
  pct: number;
  tone: 'green' | 'navy';
}) {
  return (
    <div className="rounded-lg border border-agsi-lightGray p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'green' ? 'text-agsi-green' : 'text-agsi-navy'
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-agsi-darkGray">
        of {denominator} <span className="ml-1">({fmtPct(pct)}%)</span>
      </p>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}
