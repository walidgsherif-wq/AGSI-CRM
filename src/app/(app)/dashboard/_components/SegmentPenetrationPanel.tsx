'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSegmentPenetration } from '@/server/actions/segment-penetration';
import type { ValueBand } from '@/types/coverage';
import {
  LEVEL_COLOR,
  LEVEL_LABEL,
  LEVELS,
  UNCLAIMED_COLOR,
  type Level,
  type SegmentPenetrationRow,
} from '@/lib/segment-penetration';
import {
  notifyBandChanged,
  subscribeBandChanged,
} from '@/lib/coverage-band-events';

const BANDS: { key: ValueBand; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gt_100m', label: '> 100M AED' },
  { key: 'gt_500m', label: '> 500M AED' },
  { key: 'gt_1b', label: '> 1B AED' },
];

export function SegmentPenetrationPanel({
  initial,
  initialBand = 'all',
}: {
  initial: SegmentPenetrationRow[];
  initialBand?: ValueBand;
}) {
  const [band, setBand] = useState<ValueBand>(initialBand);
  const [data, setData] = useState<SegmentPenetrationRow[]>(initial);
  const [pending, startTransition] = useTransition();

  // Fetch when the band changes. Broken out so both the button
  // handler and the event subscription can share the same code path.
  function fetchForBand(next: ValueBand) {
    startTransition(async () => {
      const rows = await getSegmentPenetration(next);
      setData(rows);
    });
  }

  function selectBand(next: ValueBand) {
    if (next === band) return;
    setBand(next);
    fetchForBand(next);
    // Tell the sibling coverage radar to move to the same band.
    notifyBandChanged(next);
  }

  // Sync with the coverage radar via the shared band-change event.
  useEffect(() => {
    return subscribeBandChanged((next) => {
      setBand((cur) => {
        if (cur === next) return cur;
        fetchForBand(next);
        return next;
      });
    });
    // fetchForBand closes over startTransition which is stable across
    // renders; safe to omit the linter dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claimedTotal = data.reduce(
    (s, r) => s + (r.total - r.unclaimed),
    0,
  );
  const overallTotal = data.reduce((s, r) => s + r.total, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Segment penetration</CardTitle>
            <CardDescription>
              Claim coverage <strong>and</strong> relationship depth per
              stakeholder type. Gray = unclaimed whitespace; L0 → L5
              light-to-dark = how deep the relationship has progressed.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1">
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
        <div className="mb-3 flex flex-wrap items-baseline gap-2 text-xs text-agsi-darkGray">
          <span>
            Overall claimed:{' '}
            <strong className="text-agsi-navy">
              {claimedTotal} of {overallTotal}
            </strong>
          </span>
          {pending && <span className="text-agsi-midGray">updating…</span>}
        </div>

        <div className="space-y-2">
          {data.map((row) => (
            <SegmentRow key={row.type} row={row} />
          ))}
        </div>

        <Legend />
      </CardContent>
    </Card>
  );
}

function SegmentRow({ row }: { row: SegmentPenetrationRow }) {
  const claimed = row.total - row.unclaimed;
  return (
    <div className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3">
      <div className="truncate text-xs text-agsi-navy">{row.label}</div>
      <StackedBar row={row} />
      <div className="text-right text-xs tabular-nums text-agsi-darkGray">
        {claimed}/{row.total}
      </div>
    </div>
  );
}

/**
 * A single 1-line bar for the row. Zero-total rows render as an empty
 * neutral track so the grid stays visually aligned.
 */
function StackedBar({ row }: { row: SegmentPenetrationRow }) {
  if (row.total === 0) {
    return (
      <div
        className="h-4 w-full rounded-sm bg-agsi-offWhite"
        title={`${row.label}: no companies in this filter`}
      />
    );
  }
  const segments: Array<{ key: string; color: string; count: number; label: string }> = [];
  if (row.unclaimed > 0) {
    segments.push({
      key: 'unclaimed',
      color: UNCLAIMED_COLOR,
      count: row.unclaimed,
      label: 'Unclaimed',
    });
  }
  for (const level of LEVELS) {
    const cnt = row.by_level[level] ?? 0;
    if (cnt > 0) {
      segments.push({
        key: level,
        color: LEVEL_COLOR[level],
        count: cnt,
        label: LEVEL_LABEL[level],
      });
    }
  }

  return (
    <div
      className="flex h-4 w-full overflow-hidden rounded-sm border border-agsi-lightGray bg-white"
      role="img"
      aria-label={`${row.label}: ${row.unclaimed} unclaimed of ${row.total}`}
    >
      {segments.map((seg) => {
        const widthPct = (seg.count / row.total) * 100;
        return (
          <div
            key={seg.key}
            title={`${row.label} · ${seg.label}: ${seg.count} of ${row.total}`}
            className="h-full"
            style={{
              width: `${widthPct}%`,
              backgroundColor: seg.color,
              minWidth: seg.count > 0 ? 2 : 0,
            }}
          />
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xxs text-agsi-darkGray">
      <LegendChip color={UNCLAIMED_COLOR} label="Unclaimed" />
      {LEVELS.map((l) => (
        <LegendChip key={l} color={LEVEL_COLOR[l]} label={LEVEL_LABEL[l]} />
      ))}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-sm border border-agsi-lightGray"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
