'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  BAND_COLOR,
  BAND_LABEL,
  BAND_SUBLABEL,
  formatAedCompact,
  formatPct,
  type MarketValueBand,
  type MarketValueColdRow,
  type MarketValueEngagement,
} from '@/lib/market-value-engagement';
import { getMarketValueEngagement } from '@/server/actions/market-value-engagement';
import type { Universe } from '@/types/coverage';
import {
  SphereFallbackNotice,
  UniverseToggle,
  universeSuffix,
} from '@/components/domain/UniverseToggle';

const BAND_ORDER: MarketValueBand[] = ['hot', 'warm', 'cooling', 'older'];

/**
 * Value-weighted engagement panel. Server component — all math already
 * resolves inside the RPC (get_market_value_engagement, 0091). Slots
 * above the temperature board on the dashboard.
 */
export function MarketValueEngagementPanel({
  data: initial,
}: {
  data: MarketValueEngagement;
}) {
  const [data, setData] = useState<MarketValueEngagement>(initial);
  const [universe, setUniverse] = useState<Universe>(
    initial.universe === 'full' && !initial.sphereEmpty ? 'full' : 'sphere',
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onUniverseChange(next: Universe) {
    if (next === universe) return;
    setUniverse(next);
    setError(null);
    startTransition(async () => {
      const r = await getMarketValueEngagement(next);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setData(r);
    });
  }

  const { headline, cold_split, whitespace, pareto, top_unengaged } = data;

  const reachPct =
    headline.total_market_value === 0
      ? 0
      : (headline.engaged_value / headline.total_market_value) * 100;
  const valueKnownPct =
    headline.live_project_count === 0
      ? 0
      : (headline.value_known_count / headline.live_project_count) * 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Market value engagement</CardTitle>
            <CardDescription>
              &ldquo;Engaged with players on {formatPct(reachPct)} of live
              market value&rdquo; {universeSuffix(data.universe)} — dedup&rsquo;d at the project level so a
              deal shared by a developer and a consultant counts once. Value
              known for {formatPct(valueKnownPct)} of live projects.
            </CardDescription>
          </div>
          <UniverseToggle value={universe} onChange={onUniverseChange} disabled={pending} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.sphereEmpty && <SphereFallbackNotice />}
        {error && (
          <div className="rounded border border-rag-red/40 bg-rag-red/5 px-3 py-2 text-xs text-rag-red">
            Refresh failed: {error}
          </div>
        )}
        <HeadlineTiles
          reachPct={reachPct}
          headline={headline}
          valueKnownPct={valueKnownPct}
        />
        <ColdSplit rows={cold_split} engagedValue={headline.engaged_value} />
        <WhitespaceList rows={whitespace} />
        <ParetoRow rows={pareto} totalValue={headline.total_market_value} />
        <TopUnengaged rows={top_unengaged} />
      </CardContent>
    </Card>
  );
}

function HeadlineTiles({
  reachPct,
  headline,
  valueKnownPct,
}: {
  reachPct: number;
  headline: MarketValueEngagement['headline'];
  valueKnownPct: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Tile
        label="Value reach"
        value={formatPct(reachPct)}
        sub={`${formatAedCompact(headline.engaged_value)} of ${formatAedCompact(headline.total_market_value)}`}
        tone="navy"
      />
      <Tile
        label="Engaged value"
        value={formatAedCompact(headline.engaged_value)}
        sub={`${headline.engaged_project_count} projects · ${headline.engaged_company_count} companies`}
        tone="green"
      />
      <Tile
        label="Unengaged value"
        value={formatAedCompact(headline.unengaged_value)}
        sub="whitespace to close"
        tone="amber"
      />
      <Tile
        label="Value known"
        value={formatPct(valueKnownPct)}
        sub={`${headline.value_known_count} of ${headline.live_project_count} live projects`}
        tone="neutral"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'navy' | 'green' | 'amber' | 'neutral';
}) {
  const toneClass =
    tone === 'navy'
      ? 'text-agsi-navy'
      : tone === 'green'
        ? 'text-agsi-green'
        : tone === 'amber'
          ? 'text-rag-amber'
          : 'text-agsi-darkGray';
  return (
    <div className="rounded-lg border border-agsi-lightGray p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      <p className="text-xxs text-agsi-darkGray">{sub}</p>
    </div>
  );
}

function ColdSplit({
  rows,
  engagedValue,
}: {
  rows: MarketValueColdRow[];
  engagedValue: number;
}) {
  const byBand: Record<MarketValueBand, MarketValueColdRow | undefined> = {
    hot: undefined,
    warm: undefined,
    cooling: undefined,
    older: undefined,
  };
  for (const r of rows) byBand[r.band] = r;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
        Engaged value by temperature
      </p>
      <div className="flex h-6 w-full overflow-hidden rounded border border-agsi-lightGray bg-white">
        {BAND_ORDER.map((b) => {
          const r = byBand[b];
          const v = r?.value ?? 0;
          const pct = engagedValue === 0 ? 0 : (v / engagedValue) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: BAND_COLOR[b] }}
              title={`${BAND_LABEL[b]} · ${BAND_SUBLABEL[b]}: ${formatAedCompact(v)} across ${r?.project_count ?? 0} projects (${formatPct(pct)})`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xxs text-agsi-darkGray">
        {BAND_ORDER.map((b) => {
          const r = byBand[b];
          return (
            <span key={b} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: BAND_COLOR[b] }}
              />
              {BAND_LABEL[b]} · {BAND_SUBLABEL[b]} —{' '}
              <strong className="text-agsi-navy">
                {formatAedCompact(r?.value ?? 0)}
              </strong>
              <span>({r?.project_count ?? 0})</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function WhitespaceList({
  rows,
}: {
  rows: MarketValueEngagement['whitespace'];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
        Value whitespace — biggest projects with no engaged linked company
      </p>
      {rows.length === 0 ? (
        <p className="text-xs italic text-agsi-darkGray">
          No unengaged value-known live projects.
        </p>
      ) : (
        <ul className="divide-y divide-agsi-lightGray rounded-lg border border-agsi-lightGray">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/projects/${r.id}` as never}
                  className="font-medium text-agsi-navy hover:underline"
                >
                  {r.name}
                </Link>
                <p className="text-xxs text-agsi-darkGray">
                  <span className="capitalize">{r.stage.replace(/_/g, ' ')}</span>
                  {r.city ? ` · ${r.city}` : ''}
                  {r.sector ? ` · ${r.sector}` : ''}
                </p>
              </div>
              <strong className="tabular-nums text-agsi-navy">
                {formatAedCompact(r.value_aed)}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ParetoRow({
  rows,
  totalValue,
}: {
  rows: MarketValueEngagement['pareto'];
  totalValue: number;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
        Pareto: cumulative distinct-project reach by top stakeholders
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        {rows.map((r) => {
          const pct = totalValue === 0 ? 0 : (r.cum_value / totalValue) * 100;
          return (
            <div
              key={r.top_n}
              className="rounded-lg border border-agsi-lightGray p-3"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
                Top {r.top_n}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-agsi-navy">
                {formatPct(pct)}
              </p>
              <p className="text-xxs text-agsi-darkGray">
                {formatAedCompact(r.cum_value)} · {r.engaged_count} engaged ·{' '}
                {r.target_count} targets
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopUnengaged({
  rows,
}: {
  rows: MarketValueEngagement['top_unengaged'];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
        Priority targets — top unengaged by associated value
      </p>
      {rows.length === 0 ? (
        <p className="text-xs italic text-agsi-darkGray">
          Every top-value stakeholder is already engaged.
        </p>
      ) : (
        <ul className="divide-y divide-agsi-lightGray rounded-lg border border-agsi-lightGray">
          {rows.map((r) => {
            const typeLabel =
              (COMPANY_TYPE_LABEL as Record<string, string>)[r.company_type] ??
              r.company_type;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/companies/${r.id}` as never}
                    className="font-medium text-agsi-navy hover:underline"
                  >
                    {r.canonical_name}
                  </Link>
                  <p className="text-xxs text-agsi-darkGray">
                    <Badge variant="amber">Not engaged</Badge>
                    <span className="ml-2">{typeLabel}</span>
                    <span className="ml-2">rank #{r.rn}</span>
                  </p>
                </div>
                <strong className="tabular-nums text-agsi-navy">
                  {formatAedCompact(r.associated_value)}
                </strong>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
