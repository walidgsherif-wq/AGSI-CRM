'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AGSI } from '@/lib/design/colors';
import { getCoverageByType } from '@/server/actions/coverage';
import type {
  CoverageResult,
  CoverageRow,
  Universe,
  ValueBand,
} from '@/types/coverage';
import {
  SphereFallbackNotice,
  UniverseToggle,
  universeSuffix,
} from '@/components/domain/UniverseToggle';
import {
  notifyBandChanged,
  subscribeBandChanged,
} from '@/lib/coverage-band-events';
import { ContributionStackedBars } from './ContributionStackedBars';
import { MemberRadarGrid } from './MemberRadarGrid';

const BANDS: { key: ValueBand; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gt_100m', label: '> 100M AED' },
  { key: 'gt_500m', label: '> 500M AED' },
  { key: 'gt_1b', label: '> 1B AED' },
];

const PCT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function CoverageRadarPanel({
  initial,
  initialBand = 'all',
}: {
  initial: CoverageResult;
  initialBand?: ValueBand;
}) {
  const [band, setBand] = useState<ValueBand>(initialBand);
  const [universe, setUniverse] = useState<Universe>(
    initial.universe === 'full' && !initial.sphereEmpty ? 'full' : 'sphere',
  );
  const [appliedUniverse, setAppliedUniverse] = useState<Universe>(
    initial.universe,
  );
  const [sphereEmpty, setSphereEmpty] = useState<boolean>(initial.sphereEmpty);
  const [data, setData] = useState<CoverageRow[]>(initial.rows);
  const [error, setError] = useState<string | null>(initial.error);
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<'segment' | 'member'>('segment');

  function refetch(nextBand: ValueBand, nextUniverse: Universe) {
    startTransition(async () => {
      const res = await getCoverageByType(nextBand, nextUniverse);
      setData(res.rows);
      setError(res.error);
      setAppliedUniverse(res.universe);
      setSphereEmpty(res.sphereEmpty);
    });
  }

  function selectBand(next: ValueBand) {
    if (next === band) return;
    setBand(next);
    refetch(next, universe);
    notifyBandChanged(next);
  }

  function selectUniverse(next: Universe) {
    if (next === universe) return;
    setUniverse(next);
    refetch(band, next);
  }

  useEffect(() => {
    return subscribeBandChanged((next) => {
      setBand((cur) => {
        if (cur === next) return cur;
        refetch(next, universe);
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe]);

  const totalNumerator = data.reduce((s, r) => s + r.numerator, 0);
  const totalDenominator = data.reduce((s, r) => s + r.denominator, 0);
  const overallPct =
    totalDenominator === 0 ? 0 : (totalNumerator / totalDenominator) * 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Coverage by stakeholder type</CardTitle>
            <CardDescription>
              Share of each market segment claimed by the BD team. Filter by
              project value to focus on the deals that matter.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UniverseToggle value={universe} onChange={selectUniverse} disabled={pending} />
            <span className="text-xxs text-agsi-midGray">·</span>
            {BANDS.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => selectBand(b.key)}
                aria-pressed={band === b.key}
                disabled={pending}
                className={
                  band === b.key
                    ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                    : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40 disabled:opacity-50'
                }
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded border border-rag-red/40 bg-rag-red/5 px-3 py-2 text-xs text-rag-red">
            <strong>Coverage failed to load:</strong> {error}
          </div>
        )}
        {sphereEmpty && <SphereFallbackNotice />}
        <div className="mb-3 flex flex-wrap items-baseline gap-2 text-xs text-agsi-darkGray">
          <span>
            Overall:{' '}
            <strong className="text-agsi-navy">
              {totalNumerator} of {totalDenominator}
            </strong>{' '}
            ({PCT.format(overallPct)}%)
            <span className="ml-1 text-agsi-midGray">
              {universeSuffix(appliedUniverse)}
            </span>
          </span>
          {pending && <span className="text-agsi-midGray">updating…</span>}
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="78%">
              <PolarGrid stroke={AGSI.lightGray} />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: AGSI.darkGray }}
              />
              <PolarRadiusAxis
                domain={[0, 100]}
                tickCount={6}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fill: AGSI.midGray }}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: `1px solid ${AGSI.lightGray}`,
                }}
                formatter={(_value, _name, item) => {
                  const r = item.payload as CoverageRow;
                  return [
                    `${r.numerator} of ${r.denominator} (${PCT.format(
                      r.coverage_pct,
                    )}%)`,
                    'Coverage',
                  ];
                }}
                labelFormatter={(label) => String(label)}
              />
              <Radar
                name="Coverage"
                dataKey="coverage_pct"
                stroke={AGSI.accent}
                fill={AGSI.accent}
                fillOpacity={0.3}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-6 border-t border-agsi-lightGray pt-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-agsi-navy">
                Member contributions
              </p>
              <p className="text-xs text-agsi-darkGray">
                Same value-band filter as the team radar. Numbers are
                normalised against each type&apos;s universe so percentages
                are comparable.
              </p>
            </div>
            <div
              className="inline-flex rounded border border-agsi-midGray bg-white p-0.5"
              role="tablist"
              aria-label="Contribution view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === 'segment'}
                onClick={() => setView('segment')}
                className={
                  view === 'segment'
                    ? 'rounded bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                    : 'rounded px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
                }
              >
                By segment
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'member'}
                onClick={() => setView('member')}
                className={
                  view === 'member'
                    ? 'rounded bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                    : 'rounded px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
                }
              >
                By member
              </button>
            </div>
          </div>

          {view === 'segment' ? (
            <ContributionStackedBars data={data} />
          ) : (
            <MemberRadarGrid data={data} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
